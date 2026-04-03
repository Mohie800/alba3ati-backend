const mongoose = require("mongoose");

const shopItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, unique: true },
    type: { type: String, enum: ["frame"], default: "frame" },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    rarity: {
      type: String,
      enum: ["common", "rare", "legendary"],
      default: "legendary",
    },
    frameType: {
      type: String,
      enum: ["color", "gradient", "image"],
      default: "image",
    },
    frameData: { type: mongoose.Schema.Types.Mixed, default: {} },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ShopItem", shopItemSchema);
