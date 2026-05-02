const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  discordId: { type: String, index: true, unique: true, sparse: true },
  characterIds: [String],
  hebrewName: String,
  mainCharacterId: String,
  lastMainCharacterChangeAt: Date,
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
