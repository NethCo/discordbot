const { EmbedBuilder } = require("discord.js");
const {
  LIVES_UPDATE_INTERVAL_MINUTES,
  SERVER_URL,
  KICK_CLIENT_ID,
  KICK_CLIENT_SECRET,
  LIVES_CHANNEL_ID,
  LIVES_MESSAGE_ID,
} = require("./config");
const { getGuildsWithLives, upsertGuildConfig, worldsLabel } = require("./lib/guildConfig");
const {
  applyUpdatedLine,
  parseUpdatedAtFromLine,
  readUpdatedLineFromEmbed,
} = require("./lib/embedUpdatedLine");
const { fetchMessageByIds } = require("./lib/findBotMessage");

const PLATFORM_URLS = {
  twitch: "https://twitch.tv/",
  kick: "https://kick.com/",
};

/** Site user id for manually added external streamers (no approval). */
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

function filterStreamersByWorlds(streamers, worlds) {
  if (!worlds?.length) return streamers;
  return streamers.filter((s) => s.world && worlds.includes(s.world));
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

const LIVES_TITLE = "Live Streams";

let kickToken = null;
let kickTokenExpiry = 0;

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

async function fetchPlatformStreams(platform, userIds) {
  if (!userIds.length) return {};

  if (platform === "kick" && KICK_CLIENT_ID && KICK_CLIENT_SECRET) {
    try {
      return await fetchKickStreamsDirect(userIds);
    } catch (err) {
      console.error("❌ Kick API ישיר:", err.message);
    }
  }

  if (!SERVER_URL) return {};

  try {
    const res = await fetch(
      `${SERVER_URL}/api/${platform}?id=${encodeURIComponent(userIds.join(","))}`,
    );
    if (!res.ok) {
      const body = await res.text();
      console.warn(`⚠️ ${platform} proxy responded with ${res.status}: ${body}`);
      return {};
    }
    const data = await res.json();
    if (data?.error) {
      console.warn(`⚠️ ${platform} proxy error: ${data.error}`);
      return {};
    }
    return data;
  } catch (err) {
    console.error(`❌ שגיאה ב-${platform} API:`, err.message);
    return {};
  }
}

async function getApprovedStreamers() {
  if (!SERVER_URL) return [];
  try {
    const res = await fetch(SERVER_URL + "/api/streamers?approved=true");
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error("❌ שגיאה בטעינת סטרימרים מהשרת:", err.message);
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

function livesMessageIds(config) {
  const ids = [];
  if (
    LIVES_MESSAGE_ID
    && LIVES_CHANNEL_ID
    && String(config.livesChannelId) === String(LIVES_CHANNEL_ID)
  ) {
    ids.push(LIVES_MESSAGE_ID);
  }
  if (config.livesMessageId) ids.push(config.livesMessageId);
  return ids;
}

async function resolveLivesMessage(channel, client, config) {
  return fetchMessageByIds(channel, client, livesMessageIds(config));
}

/** Startup / deploy — edit layout if ID works, otherwise post a fresh lives message. */
async function refreshLivesLayoutOnStartup(client) {
  const configs = await getGuildsWithLives();
  if (!configs.length) return;

  const streamers = await getApprovedStreamers();
  const { supported, liveData } = await buildLiveData(streamers);

  for (const config of configs) {
    try {
      const channel = await client.channels.fetch(config.livesChannelId);
      if (!channel) continue;

      const msg = await resolveLivesMessage(channel, client, config);
      if (msg?.embeds[0]) {
        const existingLine = readUpdatedLineFromEmbed(msg.embeds[0]);
        const updatedAt = parseUpdatedAtFromLine(existingLine) || Date.now();

        let embed = EmbedBuilder.from(msg.embeds[0])
          .setTitle(LIVES_TITLE)
          .setColor(LIVE_EMBED_COLOR);
        embed = applyLivesUpdatedLine(embed, updatedAt);

        await msg.edit({ embeds: [embed], components: [] });
        console.log(`✅ Lives layout refreshed on startup (${config.guildId}, no API)`);
      } else {
        await updateGuildLives(client, config, supported, liveData);
        console.log(`✅ Lives posted on startup (${config.guildId}) — no saved message ID`);
      }
    } catch (err) {
      console.warn(`⚠️  Lives startup (${config.guildId}): ${err.message}`);
    }
  }
}

async function updateGuildLives(client, config, supported, liveData) {
  const channel = await client.channels.fetch(config.livesChannelId);
  if (!channel) {
    console.error(`❌ ערוץ לייבים לא נמצא (guild ${config.guildId})`);
    return;
  }

  const scopedStreamers = filterStreamersByWorlds(supported, config.worlds);
  const liveStreamers = sortLiveStreamers(
    scopedStreamers.filter((s) => !!liveData[liveKey(s.platform, String(s._id))]),
    liveData,
  );

  console.log(
    `📺 לייבים (${config.guildId}, ${worldsLabel(config)}): ${scopedStreamers.length} ברשימה, ${liveStreamers.length} פעילים`,
  );

  const savedMsg = await resolveLivesMessage(channel, client, config);
  const updatedAt = Date.now();

  if (liveStreamers.length === 0) {
    const noLiveEmbed = applyLivesUpdatedLine(
      new EmbedBuilder()
        .setColor(LIVE_EMBED_COLOR)
        .setTitle(LIVES_TITLE)
        .setDescription("No live streams right now."),
      updatedAt,
    );

    if (savedMsg) {
      try {
        await savedMsg.edit({ embeds: [noLiveEmbed], components: [] });
        return;
      } catch {}
    }
    const msg = await channel.send({ embeds: [noLiveEmbed] });
    await upsertGuildConfig(config.guildId, { livesMessageId: msg.id });
    return;
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

  const embed = applyLivesUpdatedLine(
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

  if (savedMsg) {
    try {
      await savedMsg.edit({ embeds: [embed], components: [] });
      return;
    } catch {}
  }

  const msg = await channel.send({ embeds: [embed] });
  await upsertGuildConfig(config.guildId, { livesMessageId: msg.id });
}

async function updateLivesMessage(client) {
  try {
    const configs = await getGuildsWithLives();
    if (!configs.length) {
      console.warn("⚠️ אין שרתים עם ערוץ לייבים מוגדר");
      return;
    }

    const streamers = await getApprovedStreamers();
    const { supported, liveData } = await buildLiveData(streamers);

    for (const config of configs) {
      try {
        await updateGuildLives(client, config, supported, liveData);
      } catch (err) {
        console.error(`❌ שגיאה בלייבים (${config.guildId}):`, err.stack || err.message);
      }
    }
  } catch (err) {
    console.error("❌ שגיאה בעדכון לייבים:", err.stack || err.message);
  }
}

module.exports = { updateLivesMessage, refreshLivesLayoutOnStartup };
