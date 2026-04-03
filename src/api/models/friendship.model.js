const mongoose = require("mongoose");

const friendshipSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "blocked"],
      default: "pending",
    },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Only one friendship record per pair (requester→recipient)
friendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
// Fast lookups: "all friendships involving user X"
friendshipSchema.index({ requester: 1, status: 1 });
friendshipSchema.index({ recipient: 1, status: 1 });

module.exports = mongoose.model("Friendship", friendshipSchema);
