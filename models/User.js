const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  auth: {
    admin: { type: Boolean, default: false },
    streamer_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    discord: {
      id: { type: String, default: null },
      dName: { type: String, default: null },
      img: { type: String, default: null },
    },
  },
  style: {
    bio: { type: String, default: "" },
    background: { type: String, default: "" },
    mob: { type: String, default: "" },
  },
  charIds: [{ type: mongoose.Schema.Types.ObjectId }],
  paymentsIds: [String],
  favorites: [String],
}, { timestamps: true, versionKey: false });

userSchema.index({ "auth.discord.id": 1 });

module.exports = mongoose.model("User", userSchema);
