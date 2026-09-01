const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const Character = require("./models/Character");
const User = require("./models/User");
const { WEBSITE_RANKINGS_URL, LEADERBOARD_CHANNEL_ID, LEADERBOARD_MESSAGE_ID } = require("./config");
const { fetchMessageByIds } = require("./lib/findBotMessage");
const {
  applyUpdatedLine,
  buildUpdatedLine,
  readUpdatedLineFromEmbed,
} = require("./lib/embedUpdatedLine");
const { formatLevelExpPercent, formatLevelWithExpPercent } = require("./lib/expToNextLevel");
const { buildProfileUrl } = require("./lib/profileUrl");
const { characterAvatarUrl, extractCharacterImg } = require("./lib/avatars");

const LEADERBOARD_TITLE = "Rankings Leaderboard";
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
  const lvl = charData.lvl || 0;
  const exp = charData.exp || 0;
  const count = await Character.countDocuments({
    ...filter,
    $or: [
      { lvl: { $gt: lvl } },
      { lvl, exp: { $gt: exp } },
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

async function getCharactersAroundRank(charData, world = null) {
  const filter = world ? { world } : {};
  const lvl = charData.lvl || 0;
  const exp = charData.exp || 0;
  const charId = String(charData.id || charData._id || "");

  const aboveFilter = {
    ...filter,
    $or: [{ lvl: { $gt: lvl } }, { lvl, exp: { $gt: exp } }],
  };
  const belowFilter = {
    ...filter,
    $or: [{ lvl: { $lt: lvl } }, { lvl, exp: { $lt: exp } }],
  };

  const aboveCount = await Character.countDocuments(aboveFilter);
  const skipAbove = Math.max(0, aboveCount - 2);

  const [above, below] = await Promise.all([
    Character.find(aboveFilter)
      .sort({ lvl: -1, exp: -1, _id: 1 })
      .skip(skipAbove)
      .limit(2)
      .lean(),
    Character.find(belowFilter)
      .sort({ lvl: -1, exp: -1, _id: 1 })
      .limit(2)
      .lean(),
  ]);

  const rank = aboveCount + 1;
  const ordered = [...above, charData, ...below];

  return ordered.map((doc, i) => ({
    ...doc,
    rank: rank - above.length + i,
    id: (doc._id || doc.id).toString(),
    isCurrent: (doc._id || doc.id).toString() === charId,
  }));
}

function formatLvJobWorldLine(charData, fractionDigits = 2) {
  const job = String(charData.job || "—").trim() || "—";
  const world = String(charData.world || "—").trim() || "—";
  if (Number(charData.lvl) >= 300) {
    return `Lv. ${charData.lvl}, ${job} in ${world}`;
  }
  const pct = formatLevelExpPercent(charData.lvl, charData.exp, fractionDigits);
  return `Lv. ${charData.lvl} (${pct}), ${job} in ${world}`;
}

const LEADERBOARD_UPDATE_INTERVAL_TEXT = "מתעדכן כל 24 שעות";

function buildFreshUpdatedLine(updatedAt = Date.now()) {
  return buildUpdatedLine(updatedAt, LEADERBOARD_UPDATE_INTERVAL_TEXT);
}

let cachedLeaderboardUpdatedLine = null;

function setLeaderboardUpdatedLine(text) {
  cachedLeaderboardUpdatedLine = text;
}

function getLeaderboardUpdatedLine() {
  return cachedLeaderboardUpdatedLine || buildFreshUpdatedLine();
}

async function readUpdatedLineFromLeaderboardMessage(client, channelId, messageId) {
  if (!channelId || !messageId) return null;
  try {
    const channel = await client.channels.fetch(channelId);
    const msg = await channel.messages.fetch(messageId);
    return readUpdatedLineFromEmbed(msg.embeds[0]);
  } catch {
    return null;
  }
}

/** My Rank uses the same Updated line as the leaderboard message. */
let cachedLeaderboardMessageId = LEADERBOARD_MESSAGE_ID || null;

async function ensureLeaderboardFooter(client) {
  if (cachedLeaderboardUpdatedLine) return cachedLeaderboardUpdatedLine;

  if (LEADERBOARD_CHANNEL_ID) {
    const fromMessage = await readUpdatedLineFromLeaderboardMessage(
      client,
      LEADERBOARD_CHANNEL_ID,
      LEADERBOARD_MESSAGE_ID || cachedLeaderboardMessageId,
    );
    if (fromMessage) {
      setLeaderboardUpdatedLine(fromMessage);
      return fromMessage;
    }
  }

  return getLeaderboardUpdatedLine();
}

function leaderboardMessageIds() {
  const ids = [];
  if (LEADERBOARD_MESSAGE_ID) ids.push(LEADERBOARD_MESSAGE_ID);
  if (cachedLeaderboardMessageId && cachedLeaderboardMessageId !== LEADERBOARD_MESSAGE_ID) {
    ids.push(cachedLeaderboardMessageId);
  }
  return ids;
}

async function resolveLeaderboardMessage(channel, client) {
  return fetchMessageByIds(channel, client, leaderboardMessageIds());
}

function worldTag(world) {
  return `[${String(world || "—").trim() || "—"}]`;
}

function formatJobName(c) {
  return String(c.job || "—").trim() || "—";
}

function formatPlayerName(c) {
  return String(c.name || "—");
}

const COLUMN_GAP = "\u2003\u2003";
const PLAYER_WRAP = 30;

function formatRankPart(rank) {
  return rank <= 3 ? `${MEDALS[rank - 1]} ` : `${String(rank).padStart(2, " ")}. `;
}

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

function splitPlayerLines(c, withArrow = false) {
  const arrow = withArrow && c.isCurrent ? "➡️" : "";
  const head = `${LRM}${arrow}${formatRankPart(c.rank)}${worldTag(c.world)} `;
  const name = formatPlayerName(c);
  const oneLine = `${head}${name}${COLUMN_GAP}`;
  if (oneLine.length <= PLAYER_WRAP) return [oneLine];

  const nameLines = wrapWords(name, Math.max(6, PLAYER_WRAP - head.length));
  const lines = [`${head}${nameLines[0]}`];
  for (let i = 1; i < nameLines.length; i++) {
    const last = i === nameLines.length - 1;
    lines.push(`${LRM}${nameLines[i]}${last ? COLUMN_GAP : ""}`);
  }
  return lines;
}

function buildRankRow(c, withArrow = false) {
  const playerLines = splitPlayerLines(c, withArrow);
  const jobLine = `${LRM}${formatJobName(c)}${COLUMN_GAP}`;
  const levelLine = `${LRM}${formatLevelWithExpPercent(c.lvl, c.exp)}`;
  const pad = (line) => [line, ...Array(Math.max(0, playerLines.length - 1)).fill(LRM)].join("\n");

  return {
    player: playerLines.join("\n"),
    job: pad(jobLine),
    level: pad(levelLine),
  };
}

function joinColumn(lines) {
  return lines.length ? lines.join("\n") : "—";
}

function buildTableFields(rows, withArrow = false) {
  if (!rows.length) {
    return [
      { name: "Player", value: "—", inline: true },
      { name: "Job", value: "—", inline: true },
      { name: "Level", value: "—", inline: true },
    ];
  }

  const built = rows.map((c) => buildRankRow(c, withArrow));

  return [
    { name: "Player", value: joinColumn(built.map((r) => r.player)), inline: true },
    { name: "Job", value: joinColumn(built.map((r) => r.job)), inline: true },
    { name: "Level", value: joinColumn(built.map((r) => r.level)), inline: true },
  ];
}

function buildRankNeighborFields(neighbors) {
  return buildTableFields(neighbors, true);
}

function buildLeaderboardEmbed(top10, client, updatedAt = Date.now()) {
  let embed = new EmbedBuilder()
    .setColor(0xff6600)
    .setTitle(LEADERBOARD_TITLE);

  embed = top10.length
    ? embed.addFields(...buildTableFields(top10, false))
    : embed.setDescription("No ranked characters yet.");

  return applyUpdatedLine(embed, updatedAt, LEADERBOARD_UPDATE_INTERVAL_TEXT);
}

function buildLeaderboardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("my_rank").setLabel("הדירוג שלי 📊").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel("לרשימה המלאה באתר 🌐").setStyle(ButtonStyle.Link).setURL(WEBSITE_RANKINGS_URL),
  );
}

async function updateLeaderboard(client) {
  if (!LEADERBOARD_CHANNEL_ID) {
    console.warn("⚠️ LEADERBOARD_CHANNEL_ID not configured");
    return;
  }

  try {
    const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
    if (!channel) {
      console.error("❌ Leaderboard channel not found");
      return;
    }

    const top10 = await getTop10();
    const row = buildLeaderboardButtons();
    const msg = await resolveLeaderboardMessage(channel, client);
    const updatedAt = Date.now();
    setLeaderboardUpdatedLine(buildUpdatedLine(updatedAt, LEADERBOARD_UPDATE_INTERVAL_TEXT));
    const embed = buildLeaderboardEmbed(top10, client, updatedAt);

    if (msg) {
      try {
        await msg.edit({ embeds: [embed], components: [row] });
        cachedLeaderboardMessageId = msg.id;
        console.log("✅ Leaderboard updated");
        return;
      } catch (err) {
        console.warn(`⚠️ Failed to edit leaderboard message: ${err.message}`);
      }
    }

    const newMsg = await channel.send({ embeds: [embed], components: [row] });
    cachedLeaderboardMessageId = newMsg.id;
    console.log(`✅ Leaderboard posted: message ${newMsg.id} (set LEADERBOARD_MESSAGE_ID=${newMsg.id} to persist)`);
  } catch (err) {
    console.error("❌ Leaderboard update failed:", err);
  }
}

module.exports = {
  updateLeaderboard,
  getCharacterRank,
  getCharacterWorldRank,
  getCharactersAroundRank,
  getUserCharacters,
  getTop10,
  attachProfileUrls,
  resolveCharacterAvatar,
  formatLevelExpPercent,
  formatLevelWithExpPercent,
  formatLvJobWorldLine,
  ensureLeaderboardFooter,
  buildRankNeighborFields,
  buildProfileUrl,
  LEADERBOARD_UPDATE_INTERVAL_TEXT,
};
