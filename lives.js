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

/** Embed left stripe — live red */
const LIVE_EMBED_COLOR = 0xe91916;

/** Override via .env with server emoji, e.g. <:twitch:123> */
const PLATFORM_ICONS = {
  twitch: process.env.DISCORD_TWITCH_EMOJI || "🟣",
  kick: process.env.DISCORD_KICK_EMOJI || "🟢",
};

function platformIcon(platform) {
  return PLATFORM_ICONS[platform] || "📺";
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

    const liveStreamers = supported.filter(
      (s) => !!liveData[liveKey(s.platform, String(s._id))],
    );

    console.log(
      `📺 לייבים: ${supported.length} מאושרים, ${liveStreamers.length} פעילים` +
      ` (Twitch: ${Object.keys(twitchLive).length}, Kick: ${Object.keys(kickLive).length})`,
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

    let streamerColumn = "";
    let statusColumn = "";
    let viewersColumn = "";

    liveStreamers.forEach((streamer) => {
      const name = streamer.name;
      const key = liveKey(streamer.platform, String(streamer._id));
      const stream = liveData[key] || {};
      const title = stream.title || "";
      const viewers = (stream.viewers || 0).toLocaleString();
      const login = stream.login || streamer.name;
      const baseUrl = PLATFORM_URLS[streamer.platform] || PLATFORM_URLS.twitch;

      const safeTitle = title.length > 45 ? title.substring(0, 42) + "..." : title;

      streamerColumn += `${platformIcon(streamer.platform)} [${name}](${baseUrl}${login})\n\n`;
      statusColumn += `**${safeTitle}**\n\n`;
      viewersColumn += `👁 ${viewers}\n\n`;
    });

    const embed = new EmbedBuilder()
      .setColor(LIVE_EMBED_COLOR)
      .setTitle("לייבים פעילים")
      .addFields(
        { name: "שדרן", value: streamerColumn, inline: true },
        { name: "סטטוס", value: statusColumn, inline: true },
        { name: "צופים", value: viewersColumn, inline: true },
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
