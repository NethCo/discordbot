const mongoose = require("mongoose");

const characterSchema = new mongoose.Schema({
  uid: { type: String, required: true },
  name: { type: String, required: true },
  world: { type: String, required: true },
  job: String,
  lvl: { type: Number, default: 0 },
  exp: { type: Number, default: 0 },
  fame: { type: Number, default: 0 },
  img: String,
}, { timestamps: true, versionKey: false });

characterSchema.index({ lvl: -1, exp: -1 });

module.exports = mongoose.model("Character", characterSchema);
