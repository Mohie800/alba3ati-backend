const ShopItem = require("../models/shopItem.model");
const User = require("../models/user.model");
const CoinTransaction = require("../models/coinTransaction.model");

exports.getShopItems = async (req, res) => {
  try {
    const items = await ShopItem.find().sort({ sortOrder: 1 });
    res.json({ success: true, data: { items } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.createShopItem = async (req, res) => {
  try {
    const { itemId, name, price, isActive, sortOrder, rarity, frameType, frameData } = req.body;
    if (!itemId || !name || price == null) {
      return res.status(400).json({ success: false, message: "itemId, name, and price are required" });
    }
    if (frameType === "color" && (!frameData || !frameData.color)) {
      return res.status(400).json({ success: false, message: "frameData.color is required for color frames" });
    }
    if (frameType === "gradient" && (!frameData || !Array.isArray(frameData.colors) || frameData.colors.length < 2)) {
      return res.status(400).json({ success: false, message: "frameData.colors (array of 2+) is required for gradient frames" });
    }
    const item = await ShopItem.create({ itemId, name, price, isActive, sortOrder, rarity, frameType, frameData });
    res.json({ success: true, data: { item } });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Item with this ID already exists" });
    }
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateShopItem = async (req, res) => {
  try {
    const { name, price, isActive, sortOrder, rarity, frameType, frameData } = req.body;
    const item = await ShopItem.findByIdAndUpdate(
      req.params.id,
      { name, price, isActive, sortOrder, rarity, frameType, frameData },
      { new: true, runValidators: true },
    );
    if (!item) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }
    res.json({ success: true, data: { item } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteShopItem = async (req, res) => {
  try {
    const item = await ShopItem.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getPlayerCoins = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("coins name");
    if (!user) {
      return res.status(404).json({ success: false, message: "Player not found" });
    }
    const transactions = await CoinTransaction.find({ user: req.params.id })
      .sort({ createdAt: -1 })
      .limit(20);
    res.json({ success: true, data: { coins: user.coins, name: user.name, transactions } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.adjustPlayerCoins = async (req, res) => {
  try {
    const { amount, reason } = req.body;
    if (!amount || amount === 0) {
      return res.status(400).json({ success: false, message: "Non-zero amount required" });
    }
    const user = await User.findOneAndUpdate(
      { _id: req.params.id },
      { $inc: { coins: amount } },
      { new: true },
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "Player not found" });
    }
    // Prevent negative balance
    if (user.coins < 0) {
      await User.findByIdAndUpdate(req.params.id, { $set: { coins: 0 } });
      user.coins = 0;
    }
    await CoinTransaction.create({
      user: req.params.id,
      amount,
      balance: user.coins,
      type: "admin_adjust",
      meta: { reason: reason || null },
    });
    res.json({ success: true, data: { newBalance: user.coins } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
