require("dotenv").config();
const { Client, GatewayIntentBits, Partials, Events } = require("discord.js");
const { connectDB } = require("./db");
const { DISCORD_TOKEN, LIVES_UPDATE_INTERVAL_MINUTES, STATUS_CHANNEL_ID } = require("./config");
const { getCurrentHoliday, getShabbatStatus } = require("./holidays");
const { updateLeaderboard } = require("./leaderboard");
const { syncCharacterStats } = require("./syncStats");
const { updateLivesMessage } = require("./lives");
const { watchPendingCharacters, watchDMScreenshots, watchHandledRequests } = require("./verification");
const { handleInteractions } = require("./interactions");
const { updateMemberCountChannel, setupWelcome } = require("./welcome");
const { migrateLegacyEnvConfig } = require("./lib/guildConfig");
const { handleMsilCommand } = require("./msil");
const { watchMagazinePublishes, drainPendingMagazineNotifies } = require("./magazine");

const DEFAULT_BOT_STATUS = "🍁 MSIsrael.gg";

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

async function updateStatusChannel(status) {
  if (!STATUS_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
    if (!channel?.setName) {
      console.error("❌ Status channel not found or cannot be renamed");
      return;
    }
    const newName = statusToChannelName(status);
    if (channel.name === newName) return;
    await channel.setName(newName);
    console.log(`✅ ערוץ סטטוס עודכן: ${newName}`);
  } catch (err) {
    console.error("❌ שגיאה בעדכון ערוץ סטטוס:", err.message);
  }
}

async function updateBotStatus() {
  const status = resolveBotStatus();
  client.user.setActivity(status, { type: 4 }); // Custom status
  console.log(`📢 סטטוס בוט עודכן: ${status}`);
  await updateStatusChannel(status);
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

    scheduleDailyLeaderboard(client);

    await syncCharacterStats();
    await updateLeaderboard(client);
    await updateLivesMessage(client);
    setInterval(() => updateLivesMessage(client), LIVES_UPDATE_INTERVAL_MINUTES * 60 * 1000);

    await updateBotStatus();
    scheduleDailyStatusRefresh();

    await updateMemberCountChannel(client, { force: true });
    setupWelcome(client);

    watchPendingCharacters(client);
    watchDMScreenshots(client);
    watchHandledRequests(client);

    await drainPendingMagazineNotifies(client);
    watchMagazinePublishes(client);
  } catch (err) {
    console.error("❌ startup failed:", err);
  }
});

client.login(DISCORD_TOKEN);
