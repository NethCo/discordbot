const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const Character = require("./models/Character");
const User = require("./models/User");
const {
  WEBSITE_RANKINGS_URL,
  WEBSITE_CLASSIC_RANKINGS_URL,
  LEADERBOARD_CHANNEL_ID,
  LEADERBOARD_MESSAGE_ID,
} = require("./config");
const { fetchMessageByIds } = require("./lib/findBotMessage");
const {
  applyUpdatedLine,
  buildUpdatedLine,
  readUpdatedLineFromEmbed,
} = require("./lib/embedUpdatedLine");
const { formatLevelExpPercent, formatLevelWithExpPercent } = require("./lib/expToNextLevel");
const { buildProfileUrl } = require("./lib/profileUrl");
const { characterAvatarUrl, extractCharacterImg } = require("./lib/avatars");
const {
  LEADERBOARD_MODES,
  getGuildsWithLeaderboard,
  resolveLeaderboardTarget,
  saveLeaderboardMessageId,
} = require("./lib/guildConfig");

const LEADERBOARD_TITLES = {
  global: "Global Rankings Leaderboard",
  classic: "Classic Rankings Leaderboard",
};

const RANKINGS_URLS = {
  global: WEBSITE_RANKINGS_URL,
  classic: WEBSITE_CLASSIC_RANKINGS_URL || WEBSITE_RANKINGS_URL,
};

const LRM = "\u200E";
const MEDALS = ["🥇", "🥈", "🥉"];

/** Characters without mode are treated as global. */
function modeFilter(mode = "global") {
  if (mode === "classic") return { mode: "classic" };
  return { $or: [{ mode: "global" }, { mode: { $exists: false } }, { mode: null }] };
}

async function getTop10(mode = "global") {
  const docs = await Character.find(modeFilter(mode))
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

async function getCharacterRank(charData, world = null, mode = null) {
  const resolvedMode = mode || charData.mode || "global";
  const filter = {
    ...modeFilter(resolvedMode),
    ...(world ? { world } : {}),
  };
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

async function getUserCharacters(discordId, mode = null) {
  const user = await User.findOne({ "auth.discord.id": discordId }).lean();
  if (!user) return { status: "no_account", characters: [], profileUrl: null };

  const characterIds = user.charIds || [];
  if (!characterIds.length) {
    return { status: "no_characters", characters: [], profileUrl: buildProfileUrl(discordId) };
  }

  const query = { _id: { $in: characterIds } };
  if (mode) Object.assign(query, modeFilter(mode));

  const chars = await Character.find(query).lean();
  chars.sort((a, b) => b.lvl !== a.lvl ? b.lvl - a.lvl : (b.exp || 0) - (a.exp || 0));
  const result = chars.map((c) => ({ id: c._id.toString(), ...c }));
  return {
    status: result.length ? "ok" : "no_characters",
    characters: result,
    profileUrl: buildProfileUrl(discordId),
  };
}

async function getCharactersAroundRank(charData, world = null, mode = null) {
  const resolvedMode = mode || charData.mode || "global";
  const filter = {
    ...modeFilter(resolvedMode),
    ...(world ? { world } : {}),
  };
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

async function ensureLeaderboardFooter(client) {
  if (cachedLeaderboardUpdatedLine) return cachedLeaderboardUpdatedLine;

  const guilds = await getGuildsWithLeaderboard("global");
  for (const cfg of guilds) {
    const { channelId, messageId } = resolveLeaderboardTarget(cfg, "global");
    if (!channelId || !messageId) continue;
    const fromMessage = await readUpdatedLineFromLeaderboardMessage(client, channelId, messageId);
    if (fromMessage) {
      setLeaderboardUpdatedLine(fromMessage);
      return fromMessage;
    }
  }

  if (LEADERBOARD_CHANNEL_ID && LEADERBOARD_MESSAGE_ID) {
    const fromEnv = await readUpdatedLineFromLeaderboardMessage(
      client,
      LEADERBOARD_CHANNEL_ID,
      LEADERBOARD_MESSAGE_ID,
    );
    if (fromEnv) {
      setLeaderboardUpdatedLine(fromEnv);
      return fromEnv;
    }
  }

  return getLeaderboardUpdatedLine();
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

function buildLeaderboardEmbed(top10, mode = "global", updatedAt = Date.now()) {
  const title = LEADERBOARD_TITLES[mode] || LEADERBOARD_TITLES.global;
  let embed = new EmbedBuilder()
    .setColor(0xff6600)
    .setTitle(title);

  embed = top10.length
    ? embed.addFields(...buildTableFields(top10, false))
    : embed.setDescription("No ranked characters yet.");

  return applyUpdatedLine(embed, updatedAt, LEADERBOARD_UPDATE_INTERVAL_TEXT);
}

function buildLeaderboardButtons(mode = "global") {
  const url = RANKINGS_URLS[mode] || WEBSITE_RANKINGS_URL;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`my_rank_${mode}`).setLabel("הדירוג שלי 📊").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel("לרשימה המלאה באתר 🌐").setStyle(ButtonStyle.Link).setURL(url),
  );
}

async function postOrEditLeaderboard(client, channelId, messageId, embed, row, guildId, mode) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    console.error(`❌ Leaderboard channel not found: ${channelId}`);
    return null;
  }

  const resolvedGuildId = guildId || channel.guildId || null;
  const ids = [messageId].filter(Boolean);
  const msg = await fetchMessageByIds(channel, client, ids);

  if (msg) {
    try {
      await msg.edit({ embeds: [embed], components: [row] });
      await saveLeaderboardMessageId(resolvedGuildId, mode, msg.id);
      return msg.id;
    } catch (err) {
      console.warn(`⚠️ Failed to edit ${mode} leaderboard (${channelId}): ${err.message}`);
    }
  }

  const newMsg = await channel.send({ embeds: [embed], components: [row] });
  await saveLeaderboardMessageId(resolvedGuildId, mode, newMsg.id);
  console.log(`✅ ${mode} leaderboard posted in ${channelId}: message ${newMsg.id}`);
  return newMsg.id;
}

async function resolveLeaderboardTargets(mode) {
  const guilds = await getGuildsWithLeaderboard(mode);
  const targets = [];

  for (const cfg of guilds) {
    const { channelId, messageId } = resolveLeaderboardTarget(cfg, mode);
    if (!channelId) continue;
    targets.push({
      guildId: cfg.guildId,
      channelId,
      messageId,
    });
  }

  // Env fallback when no GuildConfig docs have a channel for this mode
  if (!targets.length && mode === "global" && LEADERBOARD_CHANNEL_ID) {
    targets.push({
      guildId: null,
      channelId: LEADERBOARD_CHANNEL_ID,
      messageId: LEADERBOARD_MESSAGE_ID || null,
    });
  }

  if (!targets.length && mode === "classic") {
    const classicChannel = process.env.CLASSIC_LEADERBOARD_CHANNEL_ID;
    if (classicChannel) {
      targets.push({
        guildId: null,
        channelId: classicChannel,
        messageId: process.env.CLASSIC_LEADERBOARD_MESSAGE_ID || null,
      });
    }
  }

  return targets;
}

async function updateLeaderboardForMode(client, mode = "global") {
  const targets = await resolveLeaderboardTargets(mode);
  if (!targets.length) {
    if (mode === "global") {
      console.warn("⚠️ No global leaderboard channels configured");
    }
    return;
  }

  try {
    const top10 = await getTop10(mode);
    const updatedAt = Date.now();
    if (mode === "global") {
      setLeaderboardUpdatedLine(buildUpdatedLine(updatedAt, LEADERBOARD_UPDATE_INTERVAL_TEXT));
    }
    const embed = buildLeaderboardEmbed(top10, mode, updatedAt);
    const row = buildLeaderboardButtons(mode);

    for (const target of targets) {
      try {
        await postOrEditLeaderboard(
          client,
          target.channelId,
          target.messageId,
          embed,
          row,
          target.guildId,
          mode,
        );
      } catch (err) {
        console.error(`❌ ${mode} leaderboard update failed for ${target.channelId}:`, err.message);
      }
    }

    console.log(`✅ ${mode} leaderboard updated on ${targets.length} message(s)`);
  } catch (err) {
    console.error(`❌ ${mode} leaderboard update failed:`, err);
  }
}

/** Updates Global (and Classic when channels are configured) across all guilds. */
async function updateLeaderboard(client) {
  for (const mode of LEADERBOARD_MODES) {
    await updateLeaderboardForMode(client, mode);
  }
}

module.exports = {
  updateLeaderboard,
  updateLeaderboardForMode,
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
  LEADERBOARD_TITLES,
  modeFilter,
};
