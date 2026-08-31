const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const Character = require("./models/Character");
const User = require("./models/User");
const { WEBSITE_RANKINGS_URL } = require("./config");
const { getGuildsWithLeaderboard, upsertGuildConfig } = require("./lib/guildConfig");
const { formatLevelExpPercent } = require("./lib/expToNextLevel");
const { buildProfileUrl } = require("./lib/profileUrl");
const { characterAvatarUrl, extractCharacterImg } = require("./lib/avatars");

const LEADERBOARD_TITLE = "Rankings Leaderboard";
const ROW_SEPARATOR = `\n\u200E\n`;
const LRM = "\u200E";
const MEDALS = ["🥇", "🥈", "🥉"];

async function getTop10() {
  const docs = await Character.find()
    .sort({ lvl: -1, exp: -1 })
    .limit(10)
    .lean();
  return docs.map((doc, i) => ({ rank: i + 1, id: doc._id.toString(), ...doc }));
}

async function attachProfileUrls(characters) {
  const uids = [...new Set(characters.map((c) => c.uid).filter(Boolean))];
  if (!uids.length) return characters.map((c) => ({ ...c, profileUrl: null }));

  const users = await User.find({ _id: { $in: uids } }).lean();
  const discordByUid = new Map(
    users.map((u) => [u._id, u.auth?.discord?.id || null]),
  );

  return characters.map((c) => ({
    ...c,
    profileUrl: buildProfileUrl(discordByUid.get(c.uid)),
  }));
}

async function getCharacterRank(charData, world = null) {
  const filter = world ? { world } : {};
  const count = await Character.countDocuments({
    ...filter,
    $or: [
      { lvl: { $gt: charData.lvl || 0 } },
      { lvl: charData.lvl || 0, exp: { $lte: charData.exp || 0 } },
    ],
  });
  return count + 1;
}

async function getCharacterWorldRank(charData) {
  const world = String(charData.world || "").trim();
  if (!world) return null;
  return getCharacterRank(charData, world);
}

async function resolveCharacterAvatar(charData) {
  const fromDb = characterAvatarUrl(charData.img);
  if (fromDb) return fromDb;

  const name = String(charData.name || "").trim();
  const world = String(charData.world || "").trim();
  if (!name || !world) return null;

  try {
    const { fetchOverall } = require("./lib/nexonCharacter");
    const overall = await fetchOverall(name, world);
    const extracted = extractCharacterImg(overall?.img) || overall?.img || null;
    const url = characterAvatarUrl(extracted);
    if (extracted && charData.id) {
      Character.updateOne({ _id: charData.id }, { $set: { img: extracted } }).catch(() => {});
    }
    return url;
  } catch {
    return null;
  }
}

async function getUserCharacters(discordId) {
  const user = await User.findOne({ "auth.discord.id": discordId }).lean();
  if (!user) return { status: "no_account", characters: [], profileUrl: null };

  const characterIds = user.charIds || [];
  if (!characterIds.length) {
    return { status: "no_characters", characters: [], profileUrl: buildProfileUrl(discordId) };
  }

  const chars = await Character.find({ _id: { $in: characterIds } }).lean();
  chars.sort((a, b) => b.lvl !== a.lvl ? b.lvl - a.lvl : (b.exp || 0) - (a.exp || 0));
  const result = chars.map((c) => ({ id: c._id.toString(), ...c }));
  return {
    status: result.length ? "ok" : "no_characters",
    characters: result,
    profileUrl: buildProfileUrl(discordId),
  };
}

function rankBadge(rank) {
  return MEDALS[rank - 1] || `${rank}.`;
}

function worldBadge(world) {
  const label = String(world || "—").trim() || "—";
  return `\`[${label}]\``;
}

function formatPlayerName(c) {
  const name = String(c.name || "—");
  return c.profileUrl ? `[${name}](${c.profileUrl})` : name;
}

function formatPlayerLine(c) {
  return `${LRM}${rankBadge(c.rank)} ${worldBadge(c.world)} ${formatPlayerName(c)}`;
}

function formatJobLine(c) {
  return `${LRM}${String(c.job || "—").trim() || "—"}`;
}

function formatLevelLine(c) {
  const pct = formatLevelExpPercent(c.lvl, c.exp);
  return `${LRM}**${c.lvl}** (${pct})`;
}

function joinColumn(lines) {
  return lines.join(ROW_SEPARATOR);
}

function buildLeaderboardEmbed(top10, client) {
  const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Jerusalem" });

  if (!top10.length) {
    return new EmbedBuilder()
      .setColor(0xff6600)
      .setTitle(LEADERBOARD_TITLE)
      .setDescription("No ranked characters yet.")
      .setFooter({ text: `MSIsrael.gg • Updated: ${now}`, iconURL: client.user?.displayAvatarURL({ dynamic: true }) });
  }

  return new EmbedBuilder()
    .setColor(0xff6600)
    .setTitle(LEADERBOARD_TITLE)
    .addFields(
      { name: "Player", value: joinColumn(top10.map(formatPlayerLine)), inline: true },
      { name: "Job", value: joinColumn(top10.map(formatJobLine)), inline: true },
      { name: "Level", value: joinColumn(top10.map(formatLevelLine)), inline: true },
    )
    .setFooter({ text: `MSIsrael.gg • Updated: ${now}`, iconURL: client.user?.displayAvatarURL({ dynamic: true }) });
}

function buildLeaderboardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("my_rank").setLabel("My Rank 📊").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel("Full Rankings 🌐").setStyle(ButtonStyle.Link).setURL(WEBSITE_RANKINGS_URL),
  );
}

async function updateGuildLeaderboard(client, config) {
  const channel = await client.channels.fetch(config.leaderboardChannelId);
  if (!channel) {
    console.error(`❌ Leaderboard channel not found (guild ${config.guildId})`);
    return false;
  }

  const top10 = await attachProfileUrls(await getTop10());
  const embed = buildLeaderboardEmbed(top10, client);
  const row = buildLeaderboardButtons();

  if (config.leaderboardMessageId) {
    try {
      const msg = await channel.messages.fetch(config.leaderboardMessageId);
      await msg.edit({ embeds: [embed], components: [row] });
      console.log(`✅ Leaderboard updated (${config.guildId})`);
      return true;
    } catch {}
  }

  const msg = await channel.send({ embeds: [embed], components: [row] });
  await upsertGuildConfig(config.guildId, { leaderboardMessageId: msg.id });
  console.log(`✅ Leaderboard posted (${config.guildId}):`, msg.id);
  return true;
}

async function updateLeaderboard(client) {
  try {
    const configs = await getGuildsWithLeaderboard();
    if (!configs.length) {
      console.warn("⚠️ No guilds with a leaderboard channel configured");
      return;
    }

    let ok = 0;
    for (const config of configs) {
      try {
        if (await updateGuildLeaderboard(client, config)) ok += 1;
      } catch (err) {
        console.error(`❌ Leaderboard error (${config.guildId}):`, err.message);
      }
    }
    console.log(`📊 Updated ${ok}/${configs.length} leaderboard channels`);
  } catch (err) {
    console.error("❌ Leaderboard update failed:", err);
  }
}

module.exports = {
  updateLeaderboard,
  getCharacterRank,
  getCharacterWorldRank,
  getUserCharacters,
  getTop10,
  attachProfileUrls,
  resolveCharacterAvatar,
  formatLevelExpPercent,
  buildProfileUrl,
};
