const mongoose = require("mongoose");

// Every device that ever registered or logged in; survives account deletion so a
// deleted-and-recreated account can't claim a referral as a "new device".
const deviceSeenSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  firstSeenAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("DeviceSeen", deviceSeenSchema);
