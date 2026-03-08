const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String },
  email: { type: String, unique: true, sparse: true }, // Optional for future use
  deviceId: { type: String, default: null },
  expoPushToken: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  stats: {
    gamesPlayed: { type: Number, default: 0 },
    gamesWon: { type: Number, default: 0 },
    gamesLost: { type: Number, default: 0 },
    gamesDraw: { type: Number, default: 0 },
    totalKills: { type: Number, default: 0 },
    totalNightsSurvived: { type: Number, default: 0 },
    currentWinStreak: { type: Number, default: 0 },
    bestWinStreak: { type: Number, default: 0 },
  },
});

userSchema.index({ "stats.gamesWon": -1, "stats.gamesPlayed": 1 });

module.exports = mongoose.model("User", userSchema);
