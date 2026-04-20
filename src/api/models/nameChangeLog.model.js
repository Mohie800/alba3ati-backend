const mongoose = require("mongoose");

const nameChangeLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  oldName: { type: String, required: true },
  newName: { type: String, required: true },
  changedAt: { type: Date, default: Date.now },
});

nameChangeLogSchema.index({ user: 1, changedAt: -1 });

module.exports = mongoose.model("NameChangeLog", nameChangeLogSchema);
