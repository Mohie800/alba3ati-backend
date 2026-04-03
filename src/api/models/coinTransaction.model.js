const mongoose = require("mongoose");

const coinTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  amount: { type: Number, required: true },
  balance: { type: Number, required: true },
  type: {
    type: String,
    enum: ["game_complete", "game_win", "ad_reward", "shop_purchase", "admin_adjust"],
    required: true,
  },
  meta: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
});

coinTransactionSchema.index({ user: 1, createdAt: -1 });
coinTransactionSchema.index({ user: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("CoinTransaction", coinTransactionSchema);
