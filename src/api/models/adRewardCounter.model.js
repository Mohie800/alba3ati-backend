const mongoose = require("mongoose");

const adRewardCounterSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  date: { type: String, required: true },
  count: { type: Number, default: 0 },
});

adRewardCounterSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("AdRewardCounter", adRewardCounterSchema);
