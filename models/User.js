const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  discordId: { type: String, index: true, unique: true, sparse: true },
  characterIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Character" }],
  hebrewName: String,
  mainCharacterId: { type: mongoose.Schema.Types.ObjectId, ref: "Character" },
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
