const mongoose = require("mongoose");

const worldEntrySchema = new mongoose.Schema({
  mode: { type: String, enum: ["global", "classic"], required: true },
  world: { type: String, required: true },
}, { _id: false });

const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },

  /**
   * Character-request routing ONLY (which admin channel gets which mode+world).
   * Empty = this guild handles all modes/worlds (typical for the main community guild).
   * Entries are { mode: "global"|"classic", world: "Scania" } so Global Scania ≠ Classic Scania.
   * Never used for leaderboards/lives.
   */
  worlds: { type: [worldEntrySchema], default: [] },

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
}, { timestamps: true, versionKey: false, collection: "guildconfigs" });

module.exports = mongoose.model("GuildConfig", guildConfigSchema);
