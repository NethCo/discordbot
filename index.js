require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");

const { DISCORD_TOKEN, UPDATE_INTERVAL_HOURS } = require("./config");
const { getCurrentHoliday }       = require("./holidays");
const { updateLeaderboard }        = require("./leaderboard");
const { watchPendingCharacters, watchDMScreenshots, watchHandledRequests } = require("./verification");
const { handleInteractions }       = require("./interactions");
const { updateMemberCountChannel, setupWelcome } = require("./welcome");

// ─── Discord Client ────────────────────────────────────────────────────────────
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

// ─── Bot Status ────────────────────────────────────────────────────────────────
function updateBotStatus() {
  const holiday = getCurrentHoliday();
  const status  = holiday
    ? holiday.status
    : "🍁 MapleStory Israel Community";
  client.user.setActivity(status, { type: 4 });
}

// ─── Ready ─────────────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`✅ בוט מחובר כ: ${client.user.tag}`);

  // לוח דירוגים
  await updateLeaderboard(client);
  setInterval(() => updateLeaderboard(client), UPDATE_INTERVAL_HOURS * 60 * 60 * 1000);

  // סטטוס בוט
  updateBotStatus();
  setInterval(updateBotStatus, 60 * 60 * 1000);

  // ספירת חברים
  await updateMemberCountChannel(client);
  setInterval(() => updateMemberCountChannel(client), 60 * 60 * 1000);

  // Listeners
  watchPendingCharacters(client);
  watchDMScreenshots(client);
  watchHandledRequests(client);
  handleInteractions(client);
  setupWelcome(client);
});

client.login(DISCORD_TOKEN);
