const LIVES_UPDATE_INTERVAL_MINUTES = 20;

const WORLD_ROLES = {
  Scania:   process.env.ROLE_SCANIA,
  Bera:     process.env.ROLE_BERA,
  Kronos:   process.env.ROLE_KRONOS,
  Hyperion: process.env.ROLE_HYPERION,
};

module.exports = {
  DISCORD_TOKEN:            process.env.DISCORD_TOKEN,
  LEADERBOARD_CHANNEL_ID:   process.env.LEADERBOARD_CHANNEL_ID,
  ADMIN_CHANNEL_ID:         process.env.ADMIN_CHANNEL_ID,
  WELCOME_CHANNEL_ID:       process.env.WELCOME_CHANNEL_ID,
  MEMBER_COUNT_CHANNEL_ID:  process.env.MEMBER_COUNT_CHANNEL_ID,
  LIVES_CHANNEL_ID:         process.env.LIVES_CHANNEL_ID,
  WEBSITE_URL:              process.env.WEBSITE_URL,
  WEBSITE_RANKINGS_URL:     process.env.WEBSITE_RANKINGS_URL,
  TWITCH_CLIENT_ID:         process.env.TWITCH_CLIENT_ID,
  TWITCH_APP_TOKEN:         process.env.TWITCH_APP_TOKEN,
  WORLD_ROLES,
  LIVES_UPDATE_INTERVAL_MINUTES,
};
