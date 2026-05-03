const mongoose = require("mongoose");

const characterSchema = new mongoose.Schema({
  name: String,
  world: String,
  job: String,
  level: { type: Number, default: 0 },
  exp: { type: Number, default: 0 },
  fame: { type: Number, default: 0 },
  imageUrl: String,
  ownerId: String,
}, { timestamps: true, versionKey: false });

characterSchema.index({ level: -1, exp: -1 });

module.exports = mongoose.model("Character", characterSchema);
