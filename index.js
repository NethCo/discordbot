require("dotenv").config();
const { Client, GatewayIntentBits, Partials, Events } = require("discord.js");
const { connectDB } = require("./db");
const { DISCORD_TOKEN, LIVES_UPDATE_INTERVAL_MINUTES } = require("./config");
const { getCurrentHoliday, getShabbatStatus } = require("./holidays");
const { updateLeaderboard } = require("./leaderboard");
const { syncCharacterStats } = require("./syncStats");
const { updateLivesMessage } = require("./lives");
const { watchPendingCharacters, watchDMScreenshots, watchHandledRequests } = require("./verification");
const { handleInteractions } = require("./interactions");
const { updateMemberCountChannel, setupWelcome } = require("./welcome");
const { migrateLegacyEnvConfig, getGuildsWithStatusChannel } = require("./lib/guildConfig");
const { handleMsilCommand } = require("./msil");
const { watchMagazinePublishes, drainPendingMagazineNotifies } = require("./magazine");
const BotSync = require("./models/BotSync");

const DEFAULT_BOT_STATUS = "🍁 MSIsrael.gg";
const PLAYER_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LIVES_SYNC_MAX_AGE_MS = LIVES_UPDATE_INTERVAL_MINUTES * 60 * 1000;

function isStale(lastAt, maxAgeMs) {
  if (!lastAt) return true;
  const ts = new Date(lastAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts >= maxAgeMs;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

function resolveBotStatus() {
  const holiday = getCurrentHoliday();
  if (holiday) return holiday.status;
  const shabbat = getShabbatStatus();
  if (shabbat) return shabbat;
  return DEFAULT_BOT_STATUS;
}

/** Discord channel names max 100 chars. */
function statusToChannelName(status) {
  return String(status || DEFAULT_BOT_STATUS).trim().slice(0, 100);
}

async function logStatusChannelTargets() {
  try {
    const guilds = await getGuildsWithStatusChannel();
    if (!guilds.length) {
      console.warn("⚠️ אין שרתים עם statusChannelId — ערוץ סטטוס לא יעודכן");
      return;
    }
    for (const cfg of guilds) {
      console.log(`📢 status (DB): guild=${cfg.guildId} channel=${cfg.statusChannelId}`);
    }
  } catch (err) {
    console.error("❌ לא ניתן לטעון הגדרות status channel:", err.message);
  }
}

async function updateStatusChannel(status) {
  try {
    const guilds = await getGuildsWithStatusChannel();
    if (!guilds.length) {
      console.warn("⚠️ אין statusChannelId ב-GuildConfig — דילוג על עדכון ערוץ סטטוס");
      return;
    }

    const newName = statusToChannelName(status);
    for (const cfg of guilds) {
      try {
        const channel = await client.channels.fetch(cfg.statusChannelId);
        if (!channel?.setName || channel.guildId !== cfg.guildId) {
          console.error(`❌ ערוץ סטטוס לא תקין: ${cfg.statusChannelId} (guild ${cfg.guildId})`);
          continue;
        }
        if (channel.name === newName) continue;
        await channel.setName(newName);
        console.log(`✅ ערוץ סטטוס עודכן (${cfg.guildId}): ${newName}`);
      } catch (err) {
        console.error(`❌ שגיאה בעדכון ערוץ סטטוס (${cfg.guildId}):`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ שגיאה בעדכון ערוצי סטטוס:", err.message);
  }
}

async function updateBotStatus() {
  const status = resolveBotStatus();
  client.user.setActivity(status, { type: 4 }); // Custom status
  console.log(`📢 סטטוס בוט עודכן: ${status}`);
  await updateStatusChannel(status);
  await BotSync.findByIdAndUpdate(
    "syncStatus",
    { $set: { statusLastSyncAt: new Date() } },
    { upsert: true },
  );
}

function msUntilNextIsraelMidnight() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const byType = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const currentIsrael = new Date(`${byType.year}-${byType.month}-${byType.day}T${byType.hour}:${byType.minute}:${byType.second}Z`);
  const target = new Date(currentIsrael);
  target.setUTCHours(0, 0, 0, 0);
  if (target <= currentIsrael) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return Math.max(1_000, target.getTime() - currentIsrael.getTime());
}

function scheduleDailyStatusRefresh() {
  const waitMs = msUntilNextIsraelMidnight();
  const targetTime = new Date(Date.now() + waitMs);
  console.log(`⏰ סטטוס בוט יעודכן ב-${targetTime.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}`);
  setTimeout(async () => {
    await updateBotStatus();
    scheduleDailyStatusRefresh();
  }, waitMs);
}

function msUntilNextIsrael20() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const byType = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const currentIsrael = new Date(`${byType.year}-${byType.month}-${byType.day}T${byType.hour}:${byType.minute}:${byType.second}Z`);
  const target = new Date(currentIsrael);
  target.setUTCHours(20, 0, 0, 0);
  if (target <= currentIsrael) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return Math.max(1_000, target.getTime() - currentIsrael.getTime());
}

function scheduleDailyLeaderboard(client) {
  const waitMs = msUntilNextIsrael20();
  const targetTime = new Date(Date.now() + waitMs);
  console.log(`⏰ לוח דירוגים יעודכן ב-${targetTime.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}`);
  setTimeout(async () => {
    await syncCharacterStats();
    await updateLeaderboard(client);
    scheduleDailyLeaderboard(client);
  }, waitMs);
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ בוט מחובר כ: ${client.user.tag}`);

  handleInteractions(client);
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleMsilCommand(interaction, client);
    } catch (err) {
      console.error("/msil handler error:", err);
    }
  });

  try {
    await connectDB();
    console.log("🟢 MongoDB ready");

    await migrateLegacyEnvConfig(client);

    // Join/leave + watchers before catch-up sync so welcomes aren't delayed
    setupWelcome(client);
    await logStatusChannelTargets();
    watchPendingCharacters(client);
    watchDMScreenshots(client);
    watchHandledRequests(client);
    await drainPendingMagazineNotifies(client);
    watchMagazinePublishes(client);

    scheduleDailyLeaderboard(client);

    const syncStatus = await BotSync.findById("syncStatus").lean();

    if (isStale(syncStatus?.rankingsLastSyncAt, PLAYER_SYNC_MAX_AGE_MS)) {
      console.log("🔄 עדכון שחקנים בסטארטאפ (עברו יותר מ-24 שעות מאז העדכון האחרון)");
      await syncCharacterStats();
      await updateLeaderboard(client);
    } else {
      console.log("⏭️ דילוג על עדכון שחקנים בסטארטאפ — עודכן לאחרונה תוך 24 שעות");
    }

    if (isStale(syncStatus?.livesLastSyncAt, LIVES_SYNC_MAX_AGE_MS)) {
      console.log(`🔄 עדכון לייבים בסטארטאפ (עברו יותר מ-${LIVES_UPDATE_INTERVAL_MINUTES} דקות מאז העדכון האחרון)`);
      await updateLivesMessage(client);
    } else {
      console.log(`⏭️ דילוג על עדכון לייבים בסטארטאפ — עודכן לאחרונה תוך ${LIVES_UPDATE_INTERVAL_MINUTES} דקות`);
    }
    setInterval(() => updateLivesMessage(client), LIVES_SYNC_MAX_AGE_MS);

    if (isStale(syncStatus?.statusLastSyncAt, PLAYER_SYNC_MAX_AGE_MS)) {
      console.log("🔄 עדכון סטטוס בוט בסטארטאפ (עברו יותר מ-24 שעות מאז העדכון האחרון)");
      await updateBotStatus();
    } else {
      // Presence resets on reconnect; restore activity without touching the status channel.
      const status = resolveBotStatus();
      client.user.setActivity(status, { type: 4 });
      console.log("⏭️ דילוג על עדכון ערוץ סטטוס בסטארטאפ — עודכן לאחרונה תוך 24 שעות");
    }
    scheduleDailyStatusRefresh();

    updateMemberCountChannel(client, { force: true }).catch((err) => {
      console.error("❌ שגיאה בעדכון ערוץ חברים בסטארטאפ:", err.message);
    });
  } catch (err) {
    console.error("❌ startup failed:", err);
  }
});

client.login(DISCORD_TOKEN);
