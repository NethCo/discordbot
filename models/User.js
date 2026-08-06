const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  auth: {
    admin: { type: Boolean, default: false },
    twitch_id: { type: String, default: null },
    kick_id: { type: String, default: null },
    /** null = linked only, false = pending admin, true = shows on lives page */
    streamer_approved: { type: Boolean, default: null },
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
}, { timestamps: true, versionKey: false, collection: "users" });

userSchema.index({ "auth.discord.id": 1 });
userSchema.index(
  { "auth.streamer_approved": 1 },
  { partialFilterExpression: { "auth.streamer_approved": true } },
);

module.exports = mongoose.model("User", userSchema);
