const mongoose = require("mongoose");

/** Minimal schema — site owns the full document; bot only watches notify fields. */
const magazineSchema = new mongoose.Schema({
  title: String,
  slug: String,
  summ: String,
  img: String,
  author: String,
  category: String,
  draft: Boolean,
  discordNotifyAt: Date,
  discordSentAt: Date,
}, {
  timestamps: true,
  versionKey: false,
  collection: "magazines",
  strict: false,
});

module.exports = mongoose.model("Magazine", magazineSchema);
