const mongoose = require("mongoose");

const streamerSchema = new mongoose.Schema({
  uid: String,
  twitchLogin: String,
  twitchDisplayName: String,
  twitchProfileImage: String,
  isApproved: { type: Boolean, default: false },
  createdAt: Date,
}, { timestamps: true, versionKey: false });

streamerSchema.index({ isApproved: 1 });

module.exports = mongoose.model("Streamer", streamerSchema);
