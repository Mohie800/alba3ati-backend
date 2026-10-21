const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String },
  email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  googleId: { type: String, unique: true, sparse: true },
  authProvider: { type: String, enum: ["guest", "google"], default: "guest" },
  profilePicture: { type: String, default: null },
  deviceId: { type: String, default: null },
  frame: { type: String, default: null }, // Avatar frame ID (e.g. "wreath", "wings1")
  nameColor: { type: String, default: null }, // itemId of equipped name color (e.g. "crimson")
  // itemId of the equipped shop profile picture. Distinct from `profilePicture`
  // above, which holds the Google account photo URL for google-auth users.
  equippedProfilePicture: { type: String, default: null },
  coins: { type: Number, default: 0 },
  ownedFrames: [{ type: String }],
  ownedNameColors: [{ type: String }],
  ownedProfilePictures: [{ type: String }], // itemIds of profile pictures the user owns
  ownedRoles: [{ type: String }], // roleIds of locked roles the user has unlocked
  expoPushToken: { type: String, default: null },
  notificationPreferences: {
    publicRooms: { type: Boolean, default: true },
    friendRequests: { type: Boolean, default: true },
    friendActivity: { type: Boolean, default: true },
  },
  friendCount: { type: Number, default: 0 },
  // Referrals: code is generated lazily; reward pays out on the referee's first finished game
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  referralStatus: { type: String, enum: ["pending", "rewarded", null], default: null },
  referralRewardedAt: { type: Date, default: null },
  // Device had never been seen when this account was created; required to accept a code
  referralEligible: { type: Boolean, default: false },
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
userSchema.index({ name: "text" });

module.exports = mongoose.model("User", userSchema);
