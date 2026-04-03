const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String },
  email: { type: String, unique: true, sparse: true },
  googleId: { type: String, unique: true, sparse: true },
  authProvider: { type: String, enum: ["guest", "google"], default: "guest" },
  profilePicture: { type: String, default: null },
  deviceId: { type: String, default: null },
  frame: { type: String, default: null }, // Avatar frame ID (e.g. "wreath", "wings1")
  coins: { type: Number, default: 0 },
  ownedFrames: [{ type: String }],
  expoPushToken: { type: String, default: null },
  notificationPreferences: {
    publicRooms: { type: Boolean, default: true },
    friendRequests: { type: Boolean, default: true },
    friendActivity: { type: Boolean, default: true },
  },
  friendCount: { type: Number, default: 0 },
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
userSchema.index({ deviceId: 1 });
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ name: "text" });

module.exports = mongoose.model("User", userSchema);
