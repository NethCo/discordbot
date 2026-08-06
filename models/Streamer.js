const mongoose = require("mongoose");

const streamerSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  uid: { type: String, required: true },
  platform: {
    type: String,
    enum: ["twitch", "kick", "youtube", "tiktok"],
    required: true,
  },
  name: { type: String, required: true },
  img: { type: String, default: null },
}, { timestamps: true, versionKey: false, collection: "streamers" });

streamerSchema.index({ uid: 1 });
streamerSchema.index({ platform: 1, uid: 1 });

module.exports = mongoose.model("Streamer", streamerSchema);
