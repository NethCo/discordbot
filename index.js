require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { connectDB } = require("./db");

const { DISCORD_TOKEN, LIVES_UPDATE_INTERVAL_MINUTES } = require("./config");
const { getCurrentHoliday, getShabbatStatus } = require("./holidays");
const { updateLeaderboard }        = require("./leaderboard");
const { updateLivesMessage }       = require("./lives");
const { watchPendingCharacters, watchDMScreenshots, watchHandledRequests } = require("./verification");
const { handleInteractions }       = require("./interactions");
const { updateMemberCountChannel, setupWelcome } = require("./welcome");

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

function updateBotStatus() {
  const holiday = getCurrentHoliday();
  const shabbat = getShabbatStatus();
  const status  = holiday
    ? holiday.status
    : (shabbat || "🍁 MapleStory Israel Community");
  client.user.setActivity(status, { type: 4 });
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
  const nextIsraelMidnight = new Date(currentIsrael);
  nextIsraelMidnight.setUTCDate(nextIsraelMidnight.getUTCDate() + 1);
  nextIsraelMidnight.setUTCHours(0, 0, 5, 0);
  return Math.max(1_000, nextIsraelMidnight.getTime() - currentIsrael.getTime());
}

function scheduleDailyStatusRefresh() {
  const waitMs = msUntilNextIsraelMidnight();
  setTimeout(() => {
    updateBotStatus();
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
    await updateLeaderboard(client);
    scheduleDailyLeaderboard(client);
  }, waitMs);
}

client.once("ready", async () => {
  console.log(`✅ בוט מחובר כ: ${client.user.tag}`);

  await connectDB();

  scheduleDailyLeaderboard(client);

  await updateLeaderboard(client);

  await updateLivesMessage(client);
  setInterval(() => updateLivesMessage(client), LIVES_UPDATE_INTERVAL_MINUTES * 60 * 1000);

  scheduleDailyStatusRefresh();

  await updateMemberCountChannel(client);
  setInterval(() => updateMemberCountChannel(client), 60 * 60 * 1000);

  watchPendingCharacters(client);
  watchDMScreenshots(client);
  watchHandledRequests(client);
  handleInteractions(client);
  setupWelcome(client);
});

client.login(DISCORD_TOKEN);
