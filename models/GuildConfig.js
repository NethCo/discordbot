const mongoose = require("mongoose");

const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },
  /** Empty = all worlds; otherwise only these MapleStory worlds */
  worlds: { type: [String], default: [] },
  leaderboardChannelId: { type: String, default: null },
  livesChannelId: { type: String, default: null },
  adminChannelId: { type: String, default: null },
  leaderboardMessageId: { type: String, default: null },
  livesMessageId: { type: String, default: null },
}, { timestamps: true, versionKey: false, collection: "guildconfigs" });

module.exports = mongoose.model("GuildConfig", guildConfigSchema);
