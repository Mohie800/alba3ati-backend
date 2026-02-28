const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema({
  player: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  playerName: { type: String },
  email: { type: String, default: null },
  phone: { type: String, default: null },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  source: {
    type: String,
    enum: ["app", "landing"],
    default: "app",
  },
  status: {
    type: String,
    enum: ["new", "read", "responded"],
    default: "new",
  },
  adminResponse: { type: String, default: null },
  respondedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Contact", contactSchema);
