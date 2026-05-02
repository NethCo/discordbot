const mongoose = require("mongoose");

const pendingHebrewNameSchema = new mongoose.Schema({
  _id: String,
  guildId: String,
  status: { type: String, default: "pending" },
  hebrewName: String,
  nickname: String,
}, { timestamps: true });

module.exports = mongoose.model("PendingHebrewName", pendingHebrewNameSchema);
