const mongoose = require("mongoose");

const streamerSchema = new mongoose.Schema({
  twitchLogin: String,
  twitchDisplayName: String,
  displayName: String,
  approved: { type: Boolean, default: false },
}, { timestamps: true });

streamerSchema.index({ approved: 1 });

module.exports = mongoose.model("Streamer", streamerSchema);
