const mongoose = require("mongoose");

const botSyncSchema = new mongoose.Schema({
  _id: String,
  leaderboardMessageId: String,
  livesMessageId: String,
  rankingsLastSyncSource: String,
  rankingsLastSyncResult: String,
  rankingsLastSyncAt: Date,
  rankingsLastAttemptAt: Date,
  rankingsLastSyncError: String,
  topCount: Number,
}, { timestamps: true });

module.exports = mongoose.model("BotSync", botSyncSchema);
