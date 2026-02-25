const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String },
  email: { type: String, unique: true, sparse: true }, // Optional for future use
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);
