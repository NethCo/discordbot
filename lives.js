const { EmbedBuilder } = require("discord.js");
const Streamer = require("./models/Streamer");
const BotSync = require("./models/BotSync");
const { LIVES_CHANNEL_ID, TWITCH_CLIENT_ID, TWITCH_APP_TOKEN, LIVES_UPDATE_INTERVAL_MINUTES } = require("./config");

async function fetchLiveStreams(logins) {
  if (!logins.length) return {};  
  try {
    const params = logins.map(l => "user_login=" + l).join("&");
    const res = await fetch("https://api.twitch.tv/helix/streams?" + params, {
      headers: {
        "Authorization": "Bearer " + TWITCH_APP_TOKEN,
        "Client-Id": TWITCH_CLIENT_ID,
      },
    });
    if (!res.ok) {
      console.warn(`⚠️ Twitch API responded with ${res.status}`);
      return {};
    }
    const data = await res.json();
    const map = {};
    (data.data || []).forEach(s => { map[s.user_login.toLowerCase()] = s; });
    return map;
  } catch (err) {
    console.error("❌ שגיאה ב-Twitch API:", err.message);
    return {};
  }
}

async function getApprovedStreamers() {
  return await Streamer.find({ isApproved: true }).lean();
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
    const logins = streamers.map(s => s.twitchLogin).filter(Boolean);
    const liveData = await fetchLiveStreams(logins);

    const liveStreamers = streamers.filter(s => !!liveData[s.twitchLogin?.toLowerCase()]);

    const savedId = await getLivesMessageId();
    const now = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

    if (liveStreamers.length === 0) {
      const noLiveEmbed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle("🔴 לייבים פעילים")
        .setDescription("אין שידורים פעילים כרגע")
        .setFooter({ text: `עודכן: ${now} • מתעדכן כל ${LIVES_UPDATE_INTERVAL_MINUTES} דקות` });
      
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

    const totalViewers = liveStreamers.reduce((sum, s) => 
      sum + (liveData[s.twitchLogin?.toLowerCase()]?.viewer_count || 0), 0);

    const lines = liveStreamers.map(streamer => {
      const login = streamer.twitchLogin?.toLowerCase();
      const stream = liveData[login];
      const viewers = stream?.viewer_count?.toLocaleString() || "0";
      const name = streamer.twitchDisplayName || streamer.twitchLogin;
      const title = stream?.title || "";
      return `🔴 **[${name}](https://twitch.tv/${streamer.twitchLogin})** | ${title} | 👁 ${viewers}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle("🔴 לייבים פעילים")
      .setDescription(lines.join("\n"))
      .setFooter({ 
        text: `${liveStreamers.length} שידורים • ${totalViewers.toLocaleString()} צופים • עודכן: ${now}` 
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
