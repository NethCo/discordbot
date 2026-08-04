const mongoose = require("mongoose");

const streamerSchema = new mongoose.Schema({
  uid: String,
  login: String,
  name: String,
  img: String,
  approved: { type: Boolean, default: null },
}, { timestamps: true, versionKey: false });

streamerSchema.index({ approved: 1 });

module.exports = mongoose.model("Streamer", streamerSchema);
