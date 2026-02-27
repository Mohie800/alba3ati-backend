const mongoose = require("mongoose");

const bannedDeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, index: true },
  reason: { type: String, default: "" },
  bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  bannedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("BannedDevice", bannedDeviceSchema);
