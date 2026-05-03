const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  discordId: { type: String, index: true, unique: true, sparse: true },
  characterIds: [String],
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("User", userSchema);
