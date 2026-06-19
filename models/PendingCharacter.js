const mongoose = require("mongoose");

const pendingCharacterSchema = new mongoose.Schema({
  uid: { type: String, required: true },
  name: { type: String, required: true },
  world: { type: String, required: true },
  code: { type: String, required: true },
  prtsc: { type: String | null, required: true },
  approved: { type: Boolean, default: false },
  dmSent: { type: Boolean, default: false },
  screenshotUploadedAt: Date,
  handledBy: String,
  handledAt: Date,
}, { timestamps: true, versionKey: false });

pendingCharacterSchema.index({ approved: 1 });
pendingCharacterSchema.index({ uid: 1, approved: 1 });

module.exports = mongoose.model("PendingCharacter", pendingCharacterSchema);
