const mongoose = require("mongoose");

const worldEntrySchema = new mongoose.Schema({
  /** "global" | "classic" | "all" (all modes) */
  mode: { type: String, enum: ["global", "classic", "all"], required: true },
  /** MapleStory world name, or "all" for every world in that mode */
  world: { type: String, required: true },
}, { _id: false });

const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },

  /**
   * Character-request routing ONLY (which admin channel gets which mode+world).
   * Default [{ mode: "all", world: "all" }] = every mode + world (main community guild).
   * Examples: { mode: "global", world: "Scania" }, { mode: "classic", world: "all" }.
   * Never used for leaderboards/lives.
   */
  worlds: {
    type: [worldEntrySchema],
    default: () => [{ mode: "all", world: "all" }],
  },

  /** Global rankings leaderboard message target */
  globalLeaderboardChannelId: { type: String, default: null },
  globalLeaderboardMessageId: { type: String, default: null },

  /** Classic rankings leaderboard message target (separate channel/message) */
  classicLeaderboardChannelId: { type: String, default: null },
  classicLeaderboardMessageId: { type: String, default: null },

  livesChannelId: { type: String, default: null },
  livesMessageId: { type: String, default: null },

  /** Where character verification requests are posted for this guild */
  adminChannelId: { type: String, default: null },

  /** Where new magazine articles are announced for this guild */
  magazineChannelId: { type: String, default: null },

  /** Welcome embed channel (main community guild only — set manually in DB) */
  welcomeChannelId: { type: String, default: null },

  /** Voice/text channel renamed to show human member count */
  memberCountChannelId: { type: String, default: null },

  /** Channel renamed to mirror bot custom status / holiday */
  statusChannelId: { type: String, default: null },
}, { timestamps: true, versionKey: false, collection: "guildconfigs" });

module.exports = mongoose.model("GuildConfig", guildConfigSchema);
