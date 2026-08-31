const GuildConfig = require("../models/GuildConfig");
const { ALLOWED_WORLDS } = require("./nexonCharacter");

function matchesWorlds(config, world) {
  const worlds = config?.worlds;
  if (!worlds?.length) return true;
  return worlds.includes(world);
}

function worldsLabel(config) {
  if (!config?.worlds?.length) return "כל העולמות";
  return config.worlds.join(", ");
}

async function getGuildConfig(guildId) {
  if (!guildId) return null;
  return GuildConfig.findOne({ guildId, enabled: true }).lean();
}

async function getEnabledGuilds() {
  return GuildConfig.find({ enabled: true }).lean();
}

async function getGuildsWithLeaderboard() {
  return GuildConfig.find({
    enabled: true,
    leaderboardChannelId: { $ne: null },
  }).lean();
}

async function getGuildsWithLives() {
  return GuildConfig.find({
    enabled: true,
    livesChannelId: { $ne: null },
  }).lean();
}

async function getGuildsForAdminWorld(world) {
  const configs = await GuildConfig.find({
    enabled: true,
    adminChannelId: { $ne: null },
  }).lean();
  return configs.filter((cfg) => matchesWorlds(cfg, world));
}

async function upsertGuildConfig(guildId, patch) {
  return GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { guildId, ...patch } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

function normalizeWorldsInput(raw) {
  const text = String(raw || "").trim();
  if (!text || text.toLowerCase() === "all" || text === "כל") return [];
  const parts = text.split(/[,،\s]+/).map((w) => w.trim()).filter(Boolean);
  const invalid = parts.filter((w) => !ALLOWED_WORLDS.has(w));
  if (invalid.length) {
    throw new Error(`עולמות לא תקינים: ${invalid.join(", ")}. אפשרויות: ${[...ALLOWED_WORLDS].join(", ")}`);
  }
  return [...new Set(parts)];
}

async function migrateLegacyEnvConfig(client) {
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
      worlds: [],
      leaderboardChannelId: LEADERBOARD_CHANNEL_ID || null,
      livesChannelId: LIVES_CHANNEL_ID || null,
      adminChannelId: ADMIN_CHANNEL_ID || null,
    });
    console.log(`✅ הוגדר שרת ראשון מ-env: ${channel.guildId}`);
  } catch (err) {
    console.warn("⚠️ מיגרציית env נכשלה:", err.message);
  }
}

module.exports = {
  matchesWorlds,
  worldsLabel,
  getGuildConfig,
  getEnabledGuilds,
  getGuildsWithLeaderboard,
  getGuildsWithLives,
  getGuildsForAdminWorld,
  upsertGuildConfig,
  normalizeWorldsInput,
  migrateLegacyEnvConfig,
};
