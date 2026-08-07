const { EmbedBuilder } = require("discord.js");
const BotSync = require("./models/BotSync");
const {
  LIVES_CHANNEL_ID,
  LIVES_UPDATE_INTERVAL_MINUTES,
  SERVER_URL,
  KICK_CLIENT_ID,
  KICK_CLIENT_SECRET,
} = require("./config");

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

function streamerViewers(streamer, liveData) {
  return Number(liveData[liveKey(streamer.platform, String(streamer._id))]?.viewers) || 0;
}

function sortLiveStreamers(streamers, liveData) {
  return [...streamers].sort((a, b) => streamerViewers(b, liveData) - streamerViewers(a, liveData));
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

async function getLivesMessageId() {
  const doc = await BotSync.findById("lives").lean();
  return doc?.livesMessageId || null;
}

async function saveLivesMessageId(id) {
  await BotSync.findByIdAndUpdate("lives", { livesMessageId: id }, { upsert: true });
}

async function updateLivesMessage(client) {
  try {
    if (!LIVES_CHANNEL_ID) return;
    const channel = await client.channels.fetch(LIVES_CHANNEL_ID);
    if (!channel) return console.error("❌ ערוץ לייבים לא נמצא");

    const streamers = await getApprovedStreamers();
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

    const liveStreamers = sortLiveStreamers(
      supported.filter((s) => !!liveData[liveKey(s.platform, String(s._id))]),
      liveData,
    );

    const communityLive = liveStreamers.filter((s) => !isWorldStreamer(s.uid)).length;
    const worldLive = liveStreamers.length - communityLive;

    console.log(
      `📺 לייבים: ${supported.length} ברשימה, ${liveStreamers.length} פעילים` +
      ` (קהילה: ${communityLive}, בינלאומי: ${worldLive})`,
    );

    const savedId = await getLivesMessageId();
    const now = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

    if (liveStreamers.length === 0) {
      const noLiveEmbed = new EmbedBuilder()
        .setColor(LIVE_EMBED_COLOR)
        .setTitle("לייבים פעילים")
        .setDescription("אין שידורים פעילים כרגע")
        .setFooter({
          text: `MSIsrael.gg • עודכן: ${now} • מתעדכן כל ${LIVES_UPDATE_INTERVAL_MINUTES} דקות`,
          iconURL: client.user?.displayAvatarURL({ dynamic: true }),
        });

      if (savedId) {
        try {
          const msg = await channel.messages.fetch(savedId);
          await msg.edit({ embeds: [noLiveEmbed], components: [] });
          console.log("✅ הודעת לייבים עודכנה (אין לייבים)");
          return;
        } catch {}
      }
      const msg = await channel.send({ embeds: [noLiveEmbed] });
      await saveLivesMessageId(msg.id);
      console.log("✅ נשלחה הודעת לייבים (ריקה):", msg.id);
      return;
    }

    const rows = liveStreamers.map((streamer) => {
      const name = streamer.name;
      const key = liveKey(streamer.platform, String(streamer._id));
      const stream = liveData[key] || {};
      const title = stream.title || "";
      const viewers = (stream.viewers || 0).toLocaleString();
      const login = stream.login || streamer.name;
      const baseUrl = PLATFORM_URLS[streamer.platform] || PLATFORM_URLS.twitch;

      return buildTableRow(
        formatStreamerLine(streamer, name, `${baseUrl}${login}`),
        title,
        `${LRM}👁 ${viewers}`,
      );
    });

    const shownRows = fitRowsToEmbed(rows);
    const streamerColumn = joinColumn(shownRows, "streamer");
    const statusColumn = joinColumn(shownRows, "status");
    const viewersColumn = joinColumn(shownRows, "viewers");

    const embed = new EmbedBuilder()
      .setColor(LIVE_EMBED_COLOR)
      .setTitle("לייבים פעילים")
      .addFields(
        { name: "שדרן", value: streamerColumn || "—", inline: true },
        { name: "סטטוס", value: statusColumn || "—", inline: true },
        { name: "צופים", value: viewersColumn || "—", inline: true },
      )
      .setFooter({
        text: `MSIsrael.gg • עודכן: ${now} • מתעדכן כל ${LIVES_UPDATE_INTERVAL_MINUTES} דקות`,
        iconURL: client.user?.displayAvatarURL({ dynamic: true }),
      });

    if (savedId) {
      try {
        const msg = await channel.messages.fetch(savedId);
        await msg.edit({ embeds: [embed], components: [] });
        console.log("✅ הודעת לייבים עודכנה");
        return;
      } catch {}
    }

    const msg = await channel.send({ embeds: [embed] });
    await saveLivesMessageId(msg.id);
    console.log("✅ נשלחה הודעת לייבים:", msg.id);
  } catch (err) {
    console.error("❌ שגיאה בעדכון לייבים:", err.stack || err.message);
  }
}

module.exports = { updateLivesMessage };
