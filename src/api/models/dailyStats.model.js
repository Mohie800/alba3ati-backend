const mongoose = require("mongoose");

const dailyStatsSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true }, // "YYYY-MM-DD"
  newUsers: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
  quickPlayGames: { type: Number, default: 0 },
  privateGames: { type: Number, default: 0 },
  publicGames: { type: Number, default: 0 },
  totalPlayersInGames: { type: Number, default: 0 }, // sum of players across all games
  activeUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // unique player IDs who finished a game
  // Signed-in users who opened the app (socket identified) — the real DAU
  appUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  peakConcurrent: { type: Number, default: 0 }, // raw socket connections (legacy, overcounts)
  peakOnlineUsers: { type: Number, default: 0 }, // distinct signed-in users online at once
  peakInGame: { type: Number, default: 0 }, // players inside running games at once
  // { "00".."23": { online, inGame } } — per-hour peaks in STATS_TZ
  hourly: { type: mongoose.Schema.Types.Mixed, default: {} },
  rematchGames: { type: Number, default: 0 }, // finished games that were a room's 2nd+ game
  gameResults: {
    ba3atiWins: { type: Number, default: 0 },   // result "1"
    villagerWins: { type: Number, default: 0 },  // result "2"
    abuJanzeerWins: { type: Number, default: 0 },// result "3"
    draws: { type: Number, default: 0 },          // result "0"
  },
});

dailyStatsSchema.index({ date: -1 });

module.exports = mongoose.model("DailyStats", dailyStatsSchema);
