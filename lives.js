const { EmbedBuilder } = require("discord.js");
const BotSync = require("./models/BotSync");
const { LIVES_CHANNEL_ID, LIVES_UPDATE_INTERVAL_MINUTES, SERVER_URL } = require("./config");

async function fetchLiveStreams(logins) {
  if (!logins.length) return {};
  if (!SERVER_URL) return {};
  try {
    const res = await fetch(`${SERVER_URL}/api/twitch?login=${encodeURIComponent(logins.join(","))}`);
    if (!res.ok) {
      console.warn(`⚠️ Twitch proxy responded with ${res.status}`);
      return {};
    }
    return await res.json();
  } catch (err) {
    console.error("❌ שגיאה ב-Twitch API:", err.message);
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
    const logins = streamers.map(s => s.login).filter(Boolean);
    const liveData = await fetchLiveStreams(logins);

    const liveStreamers = streamers.filter(s => !!liveData[s.login?.toLowerCase()]);

    const savedId = await getLivesMessageId();
    const now = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

    if (liveStreamers.length === 0) {
      const noLiveEmbed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle("לייבים פעילים")
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
      sum + ((liveData[s.login?.toLowerCase()]?.viewers) || 0), 0);

    // Column-based table layout
    let streamerColumn = "";
    let statusColumn = "";
    let viewersColumn = "";

    liveStreamers.forEach(streamer => {
      const name = streamer.name;
      const login = streamer.login?.toLowerCase();
      const stream = liveData[login] || {};
      const title = stream.title || "";
      const viewers = (stream.viewers || 0).toLocaleString();

      // Truncate long titles to prevent alignment breaking
      const safeTitle = title.length > 45 ? title.substring(0, 42) + "..." : title;

      streamerColumn += `[${name}](https://twitch.tv/${streamer.login})\n\n`;
      statusColumn += `**${safeTitle}**\n\n`;
      viewersColumn += `👁 ${viewers}\n\n`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle("לייבים פעילים")
      .addFields(
        { name: "שדרן", value: streamerColumn, inline: true },
        { name: "סטטוס", value: statusColumn, inline: true },
        { name: "צופים", value: viewersColumn, inline: true }
      )
      .setFooter({ 
        text: `MSIsrael.gg • עודכן: ${now} • מתעדכן כל ${LIVES_UPDATE_INTERVAL_MINUTES} דקות`,
        iconURL: client.user?.displayAvatarURL({ dynamic: true }) 
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
