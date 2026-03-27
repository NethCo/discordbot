const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { db } = require("./firebase");
const { LEADERBOARD_CHANNEL_ID, WEBSITE_RANKINGS_URL, UPDATE_INTERVAL_HOURS } = require("./config");

async function getTop10() {
  const snap = await db.collection("characters").orderBy("level", "desc").orderBy("exp", "desc").limit(10).get();
  return snap.docs.map((doc, i) => ({ rank: i + 1, ...doc.data() }));
}

async function getCharacterRank(charData) {
  const snap = await db.collection("characters").orderBy("level", "desc").orderBy("exp", "desc").get();
  let rank = 1;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.level < (charData.level || 0)) return rank;
    if (data.level === (charData.level || 0) && data.exp <= (charData.exp || 0)) return rank;
    rank++;
  }
  return rank;
}

async function getUserCharacters(discordId) {
  // אין דרך ישירה להגיע ל-uid מ-Discord ID בלי mapping;
  // לכן מחפשים users לפי discordId ואז משתמשים ב-characterIds.
  const userSnap = await db.collection("users").where("discordId", "==", discordId).limit(1).get();
  if (userSnap.empty) return { status: "no_account", characters: [] };

  const characterIds = userSnap.docs[0].data().characterIds || [];
  if (!characterIds.length) return { status: "no_characters", characters: [] };

  const refs = characterIds.map(id => db.collection("characters").doc(id));
  const charDocs = await db.getAll(...refs);
  const chars = charDocs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.level !== a.level ? b.level - a.level : (b.exp || 0) - (a.exp || 0));
  return { status: chars.length ? "ok" : "no_characters", characters: chars };
}

function buildLeaderboardEmbed(top10) {
  const medals = ["🥇", "🥈", "🥉"];
  const now = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
  if (!top10.length) {
    return new EmbedBuilder()
      .setColor(0xff6600)
      .setTitle("🍁 טופ 10 — MapleStory Community Israel")
      .setDescription("אין דמויות בדירוג עדיין")
      .setFooter({ text: `עודכן: ${now} • מתעדכן כל ${UPDATE_INTERVAL_HOURS} שעות` });
  }
  const rows = top10.map(c => {
    const pos = medals[c.rank - 1] ?? `**${c.rank}.**`;
    return `${pos} **${c.name}** — ${c.job} — רמה \`${c.level}\``;
  });
  return new EmbedBuilder()
    .setColor(0xff6600)
    .setTitle("🍁 טופ 10 — MapleStory Community Israel")
    .setDescription(rows.join("\n"))
    .setFooter({ text: `עודכן: ${now} • מתעדכן כל ${UPDATE_INTERVAL_HOURS} שעות` });
}

function buildLeaderboardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("my_rank").setLabel("📊 הדירוג שלי").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel("🌐 רשימה מלאה באתר").setStyle(ButtonStyle.Link).setURL(WEBSITE_RANKINGS_URL),
  );
}

async function getLeaderboardMessageId() {
  const doc = await db.collection("_bot").doc("leaderboard").get();
  return doc.exists ? doc.data().messageId : null;
}

async function saveLeaderboardMessageId(id) {
  await db.collection("_bot").doc("leaderboard").set({ messageId: id });
}

async function updateLeaderboard(client) {
  try {
    const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
    if (!channel) return console.error("❌ ערוץ לוח הדירוגים לא נמצא");
    const top10   = await getTop10();
    const embed   = buildLeaderboardEmbed(top10);
    const row     = buildLeaderboardButtons();
    const savedId = await getLeaderboardMessageId();
    if (savedId) {
      try {
        const msg = await channel.messages.fetch(savedId);
        await msg.edit({ embeds: [embed], components: [row] });
        console.log("✅ לוח הדירוגים עודכן");
        return;
      } catch {}
    }
    const msg = await channel.send({ embeds: [embed], components: [row] });
    await saveLeaderboardMessageId(msg.id);
    console.log("✅ נשלחה הודעת לוח דירוגים:", msg.id);
  } catch (err) {
    console.error("❌ שגיאה בעדכון לוח:", err);
  }
}

module.exports = { updateLeaderboard, getCharacterRank, getUserCharacters };
