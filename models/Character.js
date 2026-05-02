const mongoose = require("mongoose");

const characterSchema = new mongoose.Schema({
  name: String,
  world: String,
  job: String,
  level: { type: Number, default: 0 },
  exp: { type: Number, default: 0 },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

characterSchema.index({ level: -1, exp: -1 });

module.exports = mongoose.model("Character", characterSchema);
