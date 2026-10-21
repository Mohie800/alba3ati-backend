const mongoose = require("mongoose");

// One row per player per week; week = "YYYY-MM-DD" of the Saturday it starts on (Khartoum time)
const weeklyScoreSchema = new mongoose.Schema({
  week: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  wins: { type: Number, default: 0 },
  games: { type: Number, default: 0 },
  // Tiebreak after wins and games: whoever got there first
  lastWinAt: { type: Date, default: null },
});

weeklyScoreSchema.index({ week: 1, user: 1 }, { unique: true });
weeklyScoreSchema.index({ week: 1, wins: -1, games: 1, lastWinAt: 1, _id: 1 });

module.exports = mongoose.model("WeeklyScore", weeklyScoreSchema);
