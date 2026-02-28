const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  body: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  type: {
    type: String,
    enum: ["broadcast", "targeted", "contact_response"],
    default: "broadcast",
  },
  recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  recipientCount: { type: Number, default: 0 },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  sentAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Notification", notificationSchema);
