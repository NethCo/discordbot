const UPDATE_INTERVAL_HOURS = 3;

const WORLD_EMOJI = { Scania: "🌲", Bera: "🛡️", Elysium: "✨", Kronos: "⏳" };

const worldIcon = (w) => WORLD_EMOJI[w] || "🌍";

module.exports = {
  DISCORD_TOKEN:            process.env.DISCORD_TOKEN,
  LEADERBOARD_CHANNEL_ID:   process.env.LEADERBOARD_CHANNEL_ID,
  ADMIN_CHANNEL_ID:         process.env.ADMIN_CHANNEL_ID,
  WELCOME_CHANNEL_ID:       process.env.WELCOME_CHANNEL_ID,
  MEMBER_COUNT_CHANNEL_ID:  process.env.MEMBER_COUNT_CHANNEL_ID,
  WEBSITE_RANKINGS_URL:     process.env.WEBSITE_RANKINGS_URL || "https://your-site.com/rankings",
  FIREBASE_FUNCTIONS_URL:   process.env.FIREBASE_FUNCTIONS_URL,
  UPDATE_INTERVAL_HOURS,
  worldIcon,
};
