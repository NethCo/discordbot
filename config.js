require("dotenv").config();

const LIVES_UPDATE_INTERVAL_MINUTES = 20;

module.exports = {
  DISCORD_TOKEN:            process.env.DISCORD_TOKEN,
  WEBSITE_URL:              process.env.WEBSITE_URL,
  WEBSITE_RANKINGS_URL:     process.env.WEBSITE_RANKINGS_URL,
  KICK_CLIENT_ID:           process.env.KICK_CLIENT_ID,
  KICK_CLIENT_SECRET:       process.env.KICK_CLIENT_SECRET,
  TWITCH_CLIENT_ID:         process.env.TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET:     process.env.TWITCH_CLIENT_SECRET,
  TWITCH_APP_TOKEN:         process.env.TWITCH_APP_TOKEN,
  LIVES_UPDATE_INTERVAL_MINUTES,
};
