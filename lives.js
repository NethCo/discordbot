const { EmbedBuilder } = require("discord.js");
const {
  LIVES_UPDATE_INTERVAL_MINUTES,
  KICK_CLIENT_ID,
  KICK_CLIENT_SECRET,
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_APP_TOKEN,
  LIVES_CHANNEL_ID,
  LIVES_MESSAGE_ID,
} = require("./config");
const { applyUpdatedLine } = require("./lib/embedUpdatedLine");
const { fetchMessageByIds } = require("./lib/findBotMessage");
const { getGuildsWithLives, saveLivesMessageId } = require("./lib/guildConfig");
const BotSync = require("./models/BotSync");
const Streamer = require("./models/Streamer");

const PLATFORM_URLS = {
  twitch: "https://twitch.tv/",
  kick: "https://kick.com/",
};

/** Site user id for manually added external streamers (not signed up on the site). */
const WORLD_STREAMER_UID = "world";

/** Embed left stripe — live red */
const LIVE_EMBED_COLOR = 0xe91916;

/** Force LTR so leading emoji aren't swallowed in Hebrew embed fields */
const LRM = "\u200E";

const ORIGIN_ICONS = {
  community: process.env.DISCORD_COMMUNITY_EMOJI || "🇮🇱",
  world: process.env.DISCORD_WORLD_EMOJI || "🌐",
};

const PLATFORM_LABELS = {
  twitch: "Twitch",
  kick: "Kick",
};

const LIVES_TITLE = "Live Streams";

let kickToken = null;
let kickTokenExpiry = 0;
let twitchToken = null;
let twitchTokenExpiry = 0;

function isWorldStreamer(uid) {
  return uid === WORLD_STREAMER_UID;
}

function originIcon(uid) {
  return isWorldStreamer(uid) ? ORIGIN_ICONS.world : ORIGIN_ICONS.community;
}

function platformBadge(platform) {
  const label = PLATFORM_LABELS[platform] || platform;
  return `\`[${label}]\``;
}

function streamerViewers(streamer, liveData) {
  return Number(liveData[liveKey(streamer.platform, String(streamer._id))]?.viewers) || 0;
}

function sortLiveStreamers(streamers, liveData) {
  return [...streamers].sort((a, b) => {
    const aWorld = isWorldStreamer(a.uid) ? 1 : 0;
    const bWorld = isWorldStreamer(b.uid) ? 1 : 0;
    if (aWorld !== bWorld) return aWorld - bWorld;
    return streamerViewers(b, liveData) - streamerViewers(a, liveData);
  });
}

function formatStreamerLine(streamer, name, url) {
  return `${LRM}${originIcon(streamer.uid)} ${platformBadge(streamer.platform)} [${name}](${url})`;
}

/** Inline embed column width — manual wraps keep the three columns aligned. */
const STATUS_WRAP_CHARS = 26;

/** Wraps on spaces so words are never cut in half. */
function wrapWords(text, maxLen) {
  const lines = [];
  let current = "";

  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    let candidate = current ? `${current} ${word}` : word;
    while (candidate.length > maxLen) {
      if (current) {
        lines.push(current);
        current = "";
        candidate = word;
        continue;
      }
      lines.push(candidate.slice(0, maxLen));
      candidate = candidate.slice(maxLen);
    }
    current = candidate;
  }

  if (current) lines.push(current);
  return lines.length ? lines : ["—"];
}

/** LRM keeps padding lines from being trimmed away by Discord. */
function padBlock(lines, height) {
  const padded = [...lines];
  while (padded.length < height) padded.push(LRM);
  return padded;
}

function buildTableRow(streamerText, title, viewersText) {
  const status = wrapWords(title || "—", STATUS_WRAP_CHARS).map((line) => `${LRM}**${line}**`);
  const streamer = streamerText.split("\n");
  const viewers = viewersText.split("\n");
  const height = Math.max(status.length, streamer.length, viewers.length);

  return {
    streamer: padBlock(streamer, height).join("\n"),
    status: padBlock(status, height).join("\n"),
    viewers: padBlock(viewers, height).join("\n"),
  };
}

/** Blank spacer line between streamers, in every column. */
const ROW_SEPARATOR = `\n${LRM}\n`;

const EMBED_FIELD_LIMIT = 1024;

function joinColumn(rows, key) {
  return rows.map((row) => row[key]).join(ROW_SEPARATOR);
}

/** Drops the lowest-viewer rows until every column fits Discord's field limit. */
function fitRowsToEmbed(rows) {
  const kept = [...rows];
  while (
    kept.length > 1 &&
    ["streamer", "status", "viewers"].some((key) => joinColumn(kept, key).length > EMBED_FIELD_LIMIT)
  ) {
    kept.pop();
  }
  return kept;
}

function liveKey(platform, id) {
  return `${platform}:${id}`;
}

async function getKickAppToken() {
  if (kickToken && Date.now() < kickTokenExpiry - 60_000) return kickToken;

  if (!KICK_CLIENT_ID || !KICK_CLIENT_SECRET) {
    throw new Error("Kick credentials missing");
  }

  const res = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: KICK_CLIENT_ID,
      client_secret: KICK_CLIENT_SECRET,
    }),
  });

  if (!res.ok) throw new Error(`Kick token request failed (${res.status})`);

  const data = await res.json();
  kickToken = data.access_token;
  kickTokenExpiry = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return kickToken;
}

async function getTwitchAppToken() {
  if (twitchToken && Date.now() < twitchTokenExpiry - 60_000) return twitchToken;

  if (TWITCH_CLIENT_ID && TWITCH_CLIENT_SECRET) {
    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
      }),
    });

    if (!res.ok) throw new Error(`Twitch token request failed (${res.status})`);

    const data = await res.json();
    twitchToken = data.access_token;
    twitchTokenExpiry = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    return twitchToken;
  }

  if (TWITCH_APP_TOKEN) {
    twitchToken = TWITCH_APP_TOKEN;
    // Static token from env — refresh only when Helix returns 401.
    twitchTokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
    return twitchToken;
  }

  throw new Error("Twitch credentials missing");
}

async function fetchKickStreamsDirect(userIds) {
  if (!userIds.length) return {};

  const params = userIds
    .slice(0, 100)
    .map((id) => `user_id=${encodeURIComponent(id)}`)
    .join("&");

  const token = await getKickAppToken();
  const res = await fetch(`https://api.kick.com/public/v1/users/livestreams?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kick livestreams failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const map = {};

  (data.data || []).forEach((s) => {
    const userId = s?.broadcaster_user?.id;
    if (userId == null) return;
    map[String(userId)] = {
      title: s.title || "",
      thumbnail: s.thumbnail || "",
      activity: s.category?.name || "",
      viewers: Number(s.viewer_count) || 0,
      startedAt: s.started_at || "",
      login: s.channel?.slug || s.broadcaster_user?.username || "",
    };
  });

  return map;
}

async function fetchTwitchStreamsDirect(userIds) {
  if (!userIds.length) return {};
  if (!TWITCH_CLIENT_ID) throw new Error("TWITCH_CLIENT_ID missing");

  const params = userIds
    .slice(0, 100)
    .map((id) => `user_id=${encodeURIComponent(id)}`)
    .join("&");

  const token = await getTwitchAppToken();
  const res = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
    headers: {
      "Client-Id": TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    twitchToken = null;
    twitchTokenExpiry = 0;
    throw new Error("Twitch token unauthorized (401)");
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twitch streams failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const map = {};

  (data.data || []).forEach((s) => {
    if (s?.user_id == null) return;
    map[String(s.user_id)] = {
      title: s.title || "",
      thumbnail: (s.thumbnail_url || "").replace("{width}", "320").replace("{height}", "180"),
      activity: s.game_name || "",
      viewers: Number(s.viewer_count) || 0,
      startedAt: s.started_at || "",
      login: s.user_login || "",
    };
  });

  return map;
}

async function fetchPlatformStreams(platform, userIds) {
  if (!userIds.length) return {};

  try {
    if (platform === "kick") return await fetchKickStreamsDirect(userIds);
    if (platform === "twitch") return await fetchTwitchStreamsDirect(userIds);
  } catch (err) {
    console.error(`❌ ${platform} API:`, err.message);
  }

  return {};
}

async function getStreamersForLives() {
  try {
    // Match website /api/streamers?lives=true — anyone with a streamer doc
    // (connected Twitch/Kick or world) is eligible; approval is no longer required.
    return await Streamer.find({}).lean();
  } catch (err) {
    console.error("❌ שגיאה בטעינת סטרימרים מ-MongoDB:", err.message);
    return [];
  }
}

async function buildLiveData(streamers) {
  const supported = streamers.filter(
    (s) => s.platform === "twitch" || s.platform === "kick",
  );

  const twitchIds = supported
    .filter((s) => s.platform === "twitch")
    .map((s) => String(s._id))
    .filter(Boolean);
  const kickIds = supported
    .filter((s) => s.platform === "kick")
    .map((s) => String(s._id))
    .filter(Boolean);

  const [twitchLive, kickLive] = await Promise.all([
    fetchPlatformStreams("twitch", twitchIds),
    fetchPlatformStreams("kick", kickIds),
  ]);

  const liveData = {};
  for (const [id, info] of Object.entries(twitchLive)) {
    liveData[liveKey("twitch", id)] = info;
  }
  for (const [id, info] of Object.entries(kickLive)) {
    liveData[liveKey("kick", id)] = info;
  }

  return { supported, liveData };
}

function livesUpdatedIntervalText() {
  return `מתעדכן כל ${LIVES_UPDATE_INTERVAL_MINUTES} דקות`;
}

function applyLivesUpdatedLine(embed, updatedAt = Date.now()) {
  return applyUpdatedLine(embed, updatedAt, livesUpdatedIntervalText());
}

function buildLivesEmbed(liveStreamers, liveData, updatedAt = Date.now()) {
  if (liveStreamers.length === 0) {
    return applyLivesUpdatedLine(
      new EmbedBuilder()
        .setColor(LIVE_EMBED_COLOR)
        .setTitle(LIVES_TITLE)
        .setDescription("No live streams right now."),
      updatedAt,
    );
  }

  const rows = liveStreamers.map((streamer) => {
    const name = streamer.name;
    const key = liveKey(streamer.platform, String(streamer._id));
    const stream = liveData[key] || {};
    const titleText = stream.title || "";
    const viewers = (stream.viewers || 0).toLocaleString();
    const login = stream.login || streamer.name;
    const baseUrl = PLATFORM_URLS[streamer.platform] || PLATFORM_URLS.twitch;

    return buildTableRow(
      formatStreamerLine(streamer, name, `${baseUrl}${login}`),
      titleText,
      `${LRM}👁 ${viewers}`,
    );
  });

  const shownRows = fitRowsToEmbed(rows);
  const streamerColumn = joinColumn(shownRows, "streamer");
  const statusColumn = joinColumn(shownRows, "status");
  const viewersColumn = joinColumn(shownRows, "viewers");

  return applyLivesUpdatedLine(
    new EmbedBuilder()
      .setColor(LIVE_EMBED_COLOR)
      .setTitle(LIVES_TITLE)
      .addFields(
        { name: "Streamer", value: streamerColumn || "—", inline: true },
        { name: "Status", value: statusColumn || "—", inline: true },
        { name: "Viewers", value: viewersColumn || "—", inline: true },
      ),
    updatedAt,
  );
}

async function postOrEditLives(client, channelId, messageId, embed, guildId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    console.error(`❌ Lives channel not found: ${channelId}`);
    return null;
  }

  const resolvedGuildId = guildId || channel.guildId || null;
  const msg = await fetchMessageByIds(channel, client, [messageId].filter(Boolean));

  if (msg) {
    try {
      await msg.edit({ embeds: [embed], components: [] });
      await saveLivesMessageId(resolvedGuildId, msg.id);
      return msg.id;
    } catch (err) {
      console.warn(`⚠️ Failed to edit lives message (${channelId}): ${err.message}`);
    }
  }

  const newMsg = await channel.send({ embeds: [embed] });
  await saveLivesMessageId(resolvedGuildId, newMsg.id);
  console.log(`✅ Lives posted in ${channelId}: message ${newMsg.id}`);
  return newMsg.id;
}

async function resolveLivesTargets() {
  const guilds = await getGuildsWithLives();
  const targets = guilds
    .filter((cfg) => cfg.livesChannelId)
    .map((cfg) => ({
      guildId: cfg.guildId,
      channelId: cfg.livesChannelId,
      messageId: cfg.livesMessageId || null,
    }));

  if (!targets.length && LIVES_CHANNEL_ID) {
    targets.push({
      guildId: null,
      channelId: LIVES_CHANNEL_ID,
      messageId: LIVES_MESSAGE_ID || null,
    });
  }

  return targets;
}

async function updateLivesMessage(client) {
  const targets = await resolveLivesTargets();
  if (!targets.length) {
    console.warn("⚠️ No lives channels configured");
    return;
  }

  try {
    const streamers = await getStreamersForLives();
    const { supported, liveData } = await buildLiveData(streamers);
    const liveStreamers = sortLiveStreamers(
      supported.filter((s) => !!liveData[liveKey(s.platform, String(s._id))]),
      liveData,
    );

    console.log(`📺 Lives: ${supported.length} streamers, ${liveStreamers.length} live → ${targets.length} message(s)`);

    const updatedAt = Date.now();
    const embed = buildLivesEmbed(liveStreamers, liveData, updatedAt);

    for (const target of targets) {
      try {
        await postOrEditLives(
          client,
          target.channelId,
          target.messageId,
          embed,
          target.guildId,
        );
      } catch (err) {
        console.error(`❌ Lives update failed for ${target.channelId}:`, err.message);
      }
    }

    await BotSync.findByIdAndUpdate(
      "syncStatus",
      { $set: { livesLastSyncAt: new Date(updatedAt) } },
      { upsert: true },
    );
  } catch (err) {
    console.error("❌ Lives update failed:", err.stack || err.message);
  }
}

module.exports = { updateLivesMessage };
