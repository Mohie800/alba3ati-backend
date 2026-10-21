const mongoose = require("mongoose");

// Final top 3 of a finished week. The unique week makes the payout run once.
const weeklyResultSchema = new mongoose.Schema({
  week: { type: String, required: true, unique: true },
  winners: [
    {
      _id: false,
      rank: { type: Number, required: true },
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      wins: { type: Number, default: 0 },
      games: { type: Number, default: 0 },
      coins: { type: Number, default: 0 },
      paid: { type: Boolean, default: false },
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("WeeklyResult", weeklyResultSchema);
