const mongoose = require("mongoose");

const pendingCharacterSchema = new mongoose.Schema({
  discordId: String,
  charName: String,
  world: String,
  verificationCode: String,
  status: { type: String, default: "pending_verification" },
  dmSent: { type: Boolean, default: false },
  screenshotPath: String,
  screenshotUrl: String,
  screenshotUploadedAt: Date,
  adminMessageId: String,
  botHandled: { type: Boolean, default: false },
}, { timestamps: true });

pendingCharacterSchema.index({ status: 1 });
pendingCharacterSchema.index({ discordId: 1, status: 1 });

module.exports = mongoose.model("PendingCharacter", pendingCharacterSchema);
