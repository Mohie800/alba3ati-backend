const mongoose = require("mongoose");

const dailyStatsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // "YYYY-MM-DD"
  newUsers: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
  quickPlayGames: { type: Number, default: 0 },
  privateGames: { type: Number, default: 0 },
  publicGames: { type: Number, default: 0 },
  totalPlayersInGames: { type: Number, default: 0 }, // sum of players across all games
  activeUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // unique player IDs who played
  peakConcurrent: { type: Number, default: 0 },
  gameResults: {
    ba3atiWins: { type: Number, default: 0 },   // result "1"
    villagerWins: { type: Number, default: 0 },  // result "2"
    abuJanzeerWins: { type: Number, default: 0 },// result "3"
    draws: { type: Number, default: 0 },          // result "0"
  },
});

dailyStatsSchema.index({ date: -1 });

module.exports = mongoose.model("DailyStats", dailyStatsSchema);
