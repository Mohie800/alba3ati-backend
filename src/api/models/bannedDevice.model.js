const mongoose = require("mongoose");

const bannedDeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, index: true },
  reason: { type: String, required: true },
  bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  bannedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null },
});

module.exports = mongoose.model("BannedDevice", bannedDeviceSchema);
