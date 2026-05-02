const mongoose = require("mongoose");

const pendingCharacterSchema = new mongoose.Schema({
  discordId: String,
  charName: String,
  world: String,
  user: String,
  job: String,
  verificationCode: String,
  isApproved: { type: Boolean, default: null },
  dmSent: { type: Boolean, default: false },
  screenshotUrl: String,
  screenshotUploadedAt: Date,
  botHandled: { type: Boolean, default: false },
  handledBy: String,
  handledAt: Date,
}, { timestamps: true, versionKey: false });

pendingCharacterSchema.index({ isApproved: 1 });
pendingCharacterSchema.index({ discordId: 1, isApproved: 1 });

module.exports = mongoose.model("PendingCharacter", pendingCharacterSchema);
