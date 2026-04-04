const ShopItem = require("../models/shopItem.model");
const User = require("../models/user.model");
const CoinTransaction = require("../models/coinTransaction.model");

exports.getItems = async (req, res) => {
  try {
    const items = await ShopItem.find({ isActive: true }).sort({
      sortOrder: 1,
    });
    res.json({ success: true, data: { items } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getOwned = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      "ownedFrames frame",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    res.json({
      success: true,
      data: { ownedFrames: user.ownedFrames, equippedFrame: user.frame },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.purchase = async (req, res) => {
  try {
    const { userId, itemId } = req.body;
    if (!userId || !itemId) {
      return res
        .status(400)
        .json({ success: false, message: "userId and itemId required" });
    }

    const item = await ShopItem.findOne({ itemId, isActive: true });
    if (!item) {
      return res
        .status(404)
        .json({ success: false, message: "Item not found" });
    }

    // Atomic purchase: check balance >= price AND item not already owned
    const result = await User.findOneAndUpdate(
      {
        _id: userId,
        coins: { $gte: item.price },
        ownedFrames: { $ne: itemId },
      },
      { $inc: { coins: -item.price }, $addToSet: { ownedFrames: itemId } },
      { new: true },
    );

    if (!result) {
      // Determine the specific error
      const user = await User.findById(userId).select("coins ownedFrames");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      if (user.ownedFrames.includes(itemId)) {
        return res.status(400).json({ success: false, error: "already_owned" });
      }
      return res
        .status(400)
        .json({ success: false, error: "insufficient_coins" });
    }

    await CoinTransaction.create({
      user: userId,
      amount: -item.price,
      balance: result.coins,
      type: "shop_purchase",
      meta: { frameId: itemId, price: item.price },
    });

    res.json({
      success: true,
      newBalance: result.coins,
      ownedFrames: result.ownedFrames,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.equip = async (req, res) => {
  try {
    const { userId } = req.params;
    const { frame } = req.body;
    if (!frame) {
      return res
        .status(400)
        .json({ success: false, error: "frame is required" });
    }

    const user = await User.findById(userId).select("ownedFrames frame");
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    if (!user.ownedFrames.includes(frame)) {
      return res.status(400).json({ success: false, error: "Frame not owned" });
    }

    user.frame = frame;
    await user.save();

    res.json({ success: true, equippedFrame: frame });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
