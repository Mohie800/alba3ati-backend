const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reporterName: { type: String },
  reportedPlayer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reportedPlayerName: { type: String },
  room: { type: mongoose.Schema.Types.ObjectId, ref: "Room", required: true },
  roomId: { type: String },
  reason: {
    type: String,
    enum: ["inappropriate_language", "cheating", "harassment", "inappropriate_name", "other"],
    required: true,
  },
  details: { type: String, default: "" },
  status: {
    type: String,
    enum: ["pending", "dismissed", "warned", "banned"],
    default: "pending",
  },
  adminNote: { type: String, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  resolvedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

reportSchema.index({ reporter: 1, reportedPlayer: 1, room: 1 }, { unique: true });

module.exports = mongoose.model("Report", reportSchema);
