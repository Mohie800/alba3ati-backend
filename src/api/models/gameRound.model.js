const mongoose = require("mongoose");

const GameRoundSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true },
    roundNumber: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ["pending", "active", "completed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("GameRound", GameRoundSchema);
