const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const Character = require("./models/Character");
const User = require("./models/User");
const BotSync = require("./models/BotSync");
const { LEADERBOARD_CHANNEL_ID, WEBSITE_RANKINGS_URL, UPDATE_INTERVAL_HOURS } = require("./config");

async function getTop10() {
  const docs = await Character.find().sort({ level: -1, exp: -1 }).limit(10).lean();
  return docs.map((doc, i) => ({ rank: i + 1, id: doc._id.toString(), ...doc }));
}

async function getCharacterRank(charData) {
  const count = await Character.countDocuments({
    $or: [
      { level: { $gt: charData.level || 0 } },
      { level: charData.level || 0, exp: { $lte: charData.exp || 0 } },
    ],
  });
  return count + 1;
}

async function getUserCharacters(discordId) {
  const user = await User.findOne({ discordId }).lean();
  if (!user) return { status: "no_account", characters: [] };

  const characterIds = user.characterIds || [];
  if (!characterIds.length) return { status: "no_characters", characters: [] };

  const chars = await Character.find({ _id: { $in: characterIds } }).lean();
  chars.sort((a, b) => b.level !== a.level ? b.level - a.level : (b.exp || 0) - (a.exp || 0));
  const result = chars.map(c => ({ id: c._id.toString(), ...c }));
  return { status: result.length ? "ok" : "no_characters", characters: result };
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
  const syncDoc = await BotSync.findById("syncStatus").lean();
  if (syncDoc?.leaderboardMessageId) {
    return syncDoc.leaderboardMessageId;
  }
  const legacyDoc = await BotSync.findById("leaderboard").lean();
  return legacyDoc?.messageId || null;
}

async function saveLeaderboardMessageId(id) {
  await BotSync.findByIdAndUpdate("syncStatus", { leaderboardMessageId: id }, { upsert: true });
}

async function writeRankingsSyncStatus(status, extra = {}) {
  const update = {
    rankingsLastSyncSource: "discordbot.leaderboard",
    rankingsLastSyncResult: status,
    rankingsLastSyncAt: status === "ok" ? new Date() : undefined,
    rankingsLastAttemptAt: new Date(),
    ...extra,
  };
  await BotSync.findByIdAndUpdate("syncStatus", update, { upsert: true });
}

async function updateLeaderboard(client) {
  try {
    const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
    if (!channel) {
      console.error("❌ ערוץ לוח הדירוגים לא נמצא");
      await writeRankingsSyncStatus("channel-not-found");
      return;
    }
    const top10   = await getTop10();
    const embed   = buildLeaderboardEmbed(top10);
    const row     = buildLeaderboardButtons();
    const savedId = await getLeaderboardMessageId();
    if (savedId) {
      try {
        const msg = await channel.messages.fetch(savedId);
        await msg.edit({ embeds: [embed], components: [row] });
        await writeRankingsSyncStatus("ok", { topCount: top10.length });
        console.log("✅ לוח הדירוגים עודכן");
        return;
      } catch {}
    }
    const msg = await channel.send({ embeds: [embed], components: [row] });
    await saveLeaderboardMessageId(msg.id);
    await writeRankingsSyncStatus("ok", { topCount: top10.length });
    console.log("✅ נשלחה הודעת לוח דירוגים:", msg.id);
  } catch (err) {
    console.error("❌ שגיאה בעדכון לוח:", err);
    try {
      await writeRankingsSyncStatus("error", { rankingsLastSyncError: String(err?.message || err) });
    } catch {}
  }
}

module.exports = { updateLeaderboard, getCharacterRank, getUserCharacters };
