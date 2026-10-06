const GuildConfig = require("../models/GuildConfig");
const { ALLOWED_WORLDS } = require("./nexonCharacter");

const LEADERBOARD_MODES = ["global", "classic"];
const ALL_WORLDS_DEFAULT = Object.freeze([{ mode: "all", world: "all" }]);

function normalizeMode(mode) {
  const m = String(mode || "global").toLowerCase();
  if (m === "classic") return "classic";
  if (m === "all") return "all";
  return "global";
}

function isAllToken(value) {
  const v = String(value || "").trim().toLowerCase();
  return !v || v === "all" || v === "כל";
}

function entryAllows(entry, worldName, resolvedMode) {
  // Legacy string entries ("Scania") → treat as global
  if (typeof entry === "string") {
    if (isAllToken(entry)) return resolvedMode === "global" || resolvedMode === "all";
    return resolvedMode === "global" && entry === worldName;
  }

  const entryMode = normalizeMode(entry.mode);
  const entryWorld = String(entry.world || "").trim();
  const modeOk = entryMode === "all" || entryMode === resolvedMode;
  const worldOk = isAllToken(entryWorld) || entryWorld === worldName;
  return modeOk && worldOk;
}

/**
 * Character-request routing only: does this guild handle this mode+world?
 * Default / empty / { mode: "all", world: "all" } → allow everything.
 */
function matchesWorlds(config, world, mode = "global") {
  const worlds = config?.worlds;
  if (!worlds?.length) return true;

  const resolvedMode = normalizeMode(mode) === "all" ? "global" : normalizeMode(mode);
  const worldName = String(world || "").trim();

  return worlds.some((entry) => entryAllows(entry, worldName, resolvedMode));
}

function worldsLabel(config) {
  if (!config?.worlds?.length) return "all:all";
  return config.worlds.map((entry) => {
    if (typeof entry === "string") {
      return isAllToken(entry) ? "global:all" : `global:${entry}`;
    }
    return `${normalizeMode(entry.mode)}:${entry.world || "all"}`;
  }).join(", ");
}

function leaderboardChannelField(mode) {
  return mode === "classic" ? "classicLeaderboardChannelId" : "globalLeaderboardChannelId";
}

function leaderboardMessageField(mode) {
  return mode === "classic" ? "classicLeaderboardMessageId" : "globalLeaderboardMessageId";
}

function resolveLeaderboardTarget(config, mode = "global") {
  if (mode === "classic") {
    return {
      channelId: config.classicLeaderboardChannelId || null,
      messageId: config.classicLeaderboardMessageId || null,
    };
  }
  return {
    channelId: config.globalLeaderboardChannelId || null,
    messageId: config.globalLeaderboardMessageId || null,
  };
}

async function getGuildConfig(guildId) {
  if (!guildId) return null;
  return GuildConfig.findOne({ guildId, enabled: true }).lean();
}

async function getEnabledGuilds() {
  return GuildConfig.find({ enabled: true }).lean();
}

async function getGuildsWithLeaderboard(mode = "global") {
  const channelField = leaderboardChannelField(mode);
  return GuildConfig.find({
    enabled: true,
    [channelField]: { $type: "string" },
  }).lean();
}

async function getGuildsWithLives() {
  return GuildConfig.find({
    enabled: true,
    livesChannelId: { $type: "string" },
  }).lean();
}

/** Guilds whose admin channel should receive character requests for this mode+world. */
async function getGuildsForAdminWorld(world, mode = "global") {
  const configs = await GuildConfig.find({
    enabled: true,
    adminChannelId: { $type: "string" },
  }).lean();
  return configs.filter((cfg) => matchesWorlds(cfg, world, mode));
}

async function getGuildsWithMagazine() {
  return GuildConfig.find({
    enabled: true,
    magazineChannelId: { $type: "string" },
  }).lean();
}

async function getGuildsWithWelcome() {
  return GuildConfig.find({
    enabled: true,
    welcomeChannelId: { $type: "string" },
  }).lean();
}

async function getGuildsWithMemberCount() {
  return GuildConfig.find({
    enabled: true,
    memberCountChannelId: { $type: "string" },
  }).lean();
}

async function getGuildsWithStatusChannel() {
  return GuildConfig.find({
    enabled: true,
    statusChannelId: { $type: "string" },
  }).lean();
}

async function upsertGuildConfig(guildId, patch) {
  return GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { guildId, ...patch } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

async function saveLeaderboardMessageId(guildId, mode, messageId) {
  if (!guildId || !messageId) return;
  await upsertGuildConfig(guildId, { [leaderboardMessageField(mode)]: messageId });
}

async function saveLivesMessageId(guildId, messageId) {
  if (!guildId || !messageId) return;
  await upsertGuildConfig(guildId, { livesMessageId: messageId });
}

/**
 * Parse worlds input for character-request routing.
 * Formats:
 *   "all" | "all:all"           → [{ mode: "all", world: "all" }]
 *   "global:all, classic:Scania"
 *   "Scania" (bare → global)
 */
function normalizeWorldsInput(raw) {
  const text = String(raw || "").trim();
  if (!text || text.toLowerCase() === "all" || text === "כל" || text.toLowerCase() === "all:all") {
    return [{ mode: "all", world: "all" }];
  }

  const parts = text.split(/[,،]+/).map((w) => w.trim()).filter(Boolean);
  const entries = [];

  for (const part of parts) {
    const modeMatch = part.match(/^(global|classic|all)\s*:\s*(.+)$/i);
    let mode;
    let world;
    if (modeMatch) {
      mode = normalizeMode(modeMatch[1]);
      world = modeMatch[2].trim();
    } else if (isAllToken(part)) {
      mode = "all";
      world = "all";
    } else {
      mode = "global";
      world = part;
    }

    if (!world) continue;

    if (!isAllToken(world) && !ALLOWED_WORLDS.has(world)) {
      throw new Error(
        `עולם לא תקין: ${world}. אפשרויות: all, ${[...ALLOWED_WORLDS].join(", ")} ` +
        `(פורמט: all:all | global:Scania | classic:all)`,
      );
    }

    entries.push({
      mode,
      world: isAllToken(world) ? "all" : world,
    });
  }

  // If any entry is all:all, that's the whole list
  if (entries.some((e) => e.mode === "all" && e.world === "all")) {
    return [{ mode: "all", world: "all" }];
  }

  const seen = new Set();
  return entries.filter((e) => {
    const key = `${e.mode}:${e.world}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One-time: copy old leaderboardChannelId/MessageId → globalLeaderboard* if present
 * (from an earlier schema / first-deploy env seed). Safe to run every startup.
 */
async function migrateLegacyLeaderboardFields() {
  const result = await GuildConfig.updateMany(
    {
      $or: [
        { leaderboardChannelId: { $type: "string" }, globalLeaderboardChannelId: null },
        { leaderboardMessageId: { $type: "string" }, globalLeaderboardMessageId: null },
        {
          leaderboardChannelId: { $type: "string" },
          globalLeaderboardChannelId: { $exists: false },
        },
        {
          leaderboardMessageId: { $type: "string" },
          globalLeaderboardMessageId: { $exists: false },
        },
      ],
    },
    [
      {
        $set: {
          globalLeaderboardChannelId: {
            $ifNull: ["$globalLeaderboardChannelId", "$leaderboardChannelId"],
          },
          globalLeaderboardMessageId: {
            $ifNull: ["$globalLeaderboardMessageId", "$leaderboardMessageId"],
          },
        },
      },
    ],
  );
  if (result.modifiedCount > 0) {
    console.log(`✅ הועברו ${result.modifiedCount} הגדרות leaderboard → global`);
  }
}

/** One-time: ["Scania"] → [{ mode: "global", world: "Scania" }]; empty → all:all */
async function migrateLegacyWorldEntries() {
  const docs = await GuildConfig.find({
    $or: [
      { worlds: { $size: 0 } },
      { worlds: { $exists: false } },
      { worlds: { $elemMatch: { $type: "string" } } },
    ],
  }).lean();

  for (const doc of docs) {
    let worlds;
    if (!doc.worlds?.length) {
      worlds = [{ mode: "all", world: "all" }];
    } else {
      worlds = doc.worlds.map((entry) => {
        if (typeof entry === "string") {
          return isAllToken(entry)
            ? { mode: "all", world: "all" }
            : { mode: "global", world: entry };
        }
        return {
          mode: normalizeMode(entry.mode),
          world: isAllToken(entry.world) ? "all" : entry.world,
        };
      });
    }
    await GuildConfig.updateOne({ _id: doc._id }, { $set: { worlds } });
  }

  if (docs.length > 0) {
    console.log(`✅ הועברו ${docs.length} רשימות worlds → mode+world (incl. all:all)`);
  }
}

/** First deploy only: seed the main community guild from env when GuildConfig is empty. */
async function migrateLegacyEnvConfig(client) {
  await migrateLegacyLeaderboardFields();
  await migrateLegacyWorldEntries();

  const {
    LEADERBOARD_CHANNEL_ID,
    LIVES_CHANNEL_ID,
    ADMIN_CHANNEL_ID,
  } = require("../config");

  const seedChannelId = LEADERBOARD_CHANNEL_ID || LIVES_CHANNEL_ID || ADMIN_CHANNEL_ID;
  if (!seedChannelId) return;

  const existing = await GuildConfig.countDocuments();
  if (existing > 0) return;

  try {
    const channel = await client.channels.fetch(seedChannelId);
    if (!channel?.guildId) return;

    await upsertGuildConfig(channel.guildId, {
      enabled: true,
      worlds: [...ALL_WORLDS_DEFAULT],
      globalLeaderboardChannelId: LEADERBOARD_CHANNEL_ID || null,
      globalLeaderboardMessageId: process.env.LEADERBOARD_MESSAGE_ID || null,
      classicLeaderboardChannelId: process.env.CLASSIC_LEADERBOARD_CHANNEL_ID || null,
      classicLeaderboardMessageId: process.env.CLASSIC_LEADERBOARD_MESSAGE_ID || null,
      livesChannelId: LIVES_CHANNEL_ID || null,
      livesMessageId: process.env.LIVES_MESSAGE_ID || null,
      adminChannelId: ADMIN_CHANNEL_ID || null,
    });
    console.log(`✅ הוגדר שרת ראשון מ-env: ${channel.guildId}`);
  } catch (err) {
    console.warn("⚠️ מיגרציית env נכשלה:", err.message);
  }
}

module.exports = {
  LEADERBOARD_MODES,
  ALL_WORLDS_DEFAULT,
  normalizeMode,
  matchesWorlds,
  worldsLabel,
  resolveLeaderboardTarget,
  leaderboardChannelField,
  leaderboardMessageField,
  getGuildConfig,
  getEnabledGuilds,
  getGuildsWithLeaderboard,
  getGuildsWithLives,
  getGuildsForAdminWorld,
  getGuildsWithMagazine,
  getGuildsWithWelcome,
  getGuildsWithMemberCount,
  getGuildsWithStatusChannel,
  upsertGuildConfig,
  saveLeaderboardMessageId,
  saveLivesMessageId,
  normalizeWorldsInput,
  migrateLegacyEnvConfig,
  migrateLegacyLeaderboardFields,
  migrateLegacyWorldEntries,
};
