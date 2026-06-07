const mongoose = require("mongoose");

const shopItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true, unique: true },
    type: {
      type: String,
      enum: ["frame", "nameColor", "profilePicture"],
      default: "frame",
    },
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
    // Relative path to the uploaded image, e.g. "/uploads/shop-items/123.webp".
    // Used by profilePicture items (and any future image-backed item type).
    imageUrl: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ShopItem", shopItemSchema);
