const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const Character = require("./models/Character");
const User = require("./models/User");
const BotSync = require("./models/BotSync");
const { LEADERBOARD_CHANNEL_ID, WEBSITE_RANKINGS_URL } = require("./config");

async function getTop10() {
  const docs = await Character.find().sort({ lvl: -1, exp: -1 }).limit(10).lean();
  return docs.map((doc, i) => ({ rank: i + 1, id: doc._id.toString(), ...doc }));
}

async function getCharacterRank(charData) {
  const count = await Character.countDocuments({
    $or: [
      { lvl: { $gt: charData.lvl || 0 } },
      { lvl: charData.lvl || 0, exp: { $lte: charData.exp || 0 } },
    ],
  });
  return count + 1;
}

async function getUserCharacters(discordId) {
  const user = await User.findOne({ "auth.discord.id": discordId }).lean();
  if (!user) return { status: "no_account", characters: [] };

  const characterIds = user.charIds || [];
  if (!characterIds.length) return { status: "no_characters", characters: [] };

  const chars = await Character.find({ _id: { $in: characterIds } }).lean();
  chars.sort((a, b) => b.lvl !== a.lvl ? b.lvl - a.lvl : (b.exp || 0) - (a.exp || 0));
  const result = chars.map(c => ({ id: c._id.toString(), ...c }));
  return { status: result.length ? "ok" : "no_characters", characters: result };
}

const LRM = "\u200E";
const MEDALS = ["🥇", "🥈", "🥉"];

function rankBadge(rank) {
  return MEDALS[rank - 1] || `${rank}.`;
}

function worldBadge(world) {
  const label = String(world || "—").trim() || "—";
  return `\`[${label}]\``;
}

function formatCharacterLine(c) {
  return `${LRM}${rankBadge(c.rank)} ${worldBadge(c.world)} ${c.name}`;
}

function buildLeaderboardEmbed(top10, client) {
  const now = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
  if (!top10.length) {
    return new EmbedBuilder()
      .setColor(0xff6600)
      .setTitle("🍁 טופ 10 — MapleStory Global Israel")
      .setDescription("אין דמויות בדירוג עדיין")
      .setFooter({ text: `MSIsrael.gg • עודכן: ${now}`, iconURL: client.user?.displayAvatarURL({ dynamic: true }) });
  }

  const charColumn = top10.map((c) => formatCharacterLine(c)).join(`\n${LRM}\n`);
  const levelColumn = top10.map((c) => `${LRM}**${c.lvl}**`).join(`\n${LRM}\n`);

  return new EmbedBuilder()
    .setColor(0xff6600)
    .setTitle("🍁 טופ 10 — MapleStory Global Israel")
    .addFields(
      { name: `${LRM}דמות`, value: charColumn, inline: true },
      { name: `${LRM}רמה`, value: levelColumn, inline: true },
    )
    .setFooter({ text: `MSIsrael.gg • עודכן: ${now}`, iconURL: client.user?.displayAvatarURL({ dynamic: true }) });
}

function buildLeaderboardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("my_rank").setLabel("הדירוג שלי 📊").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel("לטבלה המלאה באתר 🌐").setStyle(ButtonStyle.Link).setURL(WEBSITE_RANKINGS_URL),
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
    const embed   = buildLeaderboardEmbed(top10, client);
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
