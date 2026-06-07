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
      "ownedFrames frame ownedNameColors nameColor ownedProfilePictures equippedProfilePicture",
    );
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    res.json({
      success: true,
      data: {
        ownedFrames: user.ownedFrames || [],
        equippedFrame: user.frame || null,
        ownedNameColors: user.ownedNameColors || [],
        equippedNameColor: user.nameColor || null,
        ownedProfilePictures: user.ownedProfilePictures || [],
        equippedProfilePicture: user.equippedProfilePicture || null,
      },
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

    // Map item type → the user array that tracks ownership of that cosmetic.
    const OWNED_FIELD = {
      nameColor: "ownedNameColors",
      profilePicture: "ownedProfilePictures",
      frame: "ownedFrames",
    };
    const ownedField = OWNED_FIELD[item.type] || "ownedFrames";

    // Atomic purchase: check balance >= price AND item not already owned
    const result = await User.findOneAndUpdate(
      {
        _id: userId,
        coins: { $gte: item.price },
        [ownedField]: { $ne: itemId },
      },
      { $inc: { coins: -item.price }, $addToSet: { [ownedField]: itemId } },
      { new: true },
    );

    if (!result) {
      // Determine the specific error
      const user = await User.findById(userId).select(
        "coins ownedFrames ownedNameColors ownedProfilePictures",
      );
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      if ((user[ownedField] || []).includes(itemId)) {
        return res.status(400).json({ success: false, error: "already_owned" });
      }
      return res
        .status(400)
        .json({ success: false, error: "insufficient_coins" });
    }

    const META = {
      nameColor: { nameColorId: itemId, price: item.price },
      profilePicture: { profilePictureId: itemId, price: item.price },
      frame: { frameId: itemId, price: item.price },
    };
    await CoinTransaction.create({
      user: userId,
      amount: -item.price,
      balance: result.coins,
      type: "shop_purchase",
      meta: META[item.type] || META.frame,
    });

    const response = {
      success: true,
      newBalance: result.coins,
    };
    response[ownedField] = result[ownedField];
    console.info(
      `[Shop] Purchased: user=${userId} type=${item.type} item=${itemId} price=${item.price}`,
    );
    res.json(response);
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.equipNameColor = async (req, res) => {
  try {
    const { userId } = req.params;
    const { nameColor } = req.body; // string itemId, or null to unequip

    if (nameColor !== null && typeof nameColor !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "nameColor must be string or null" });
    }

    const user = await User.findById(userId).select("ownedNameColors nameColor");
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    if (nameColor !== null && !(user.ownedNameColors || []).includes(nameColor)) {
      return res.status(400).json({ success: false, error: "Name color not owned" });
    }

    user.nameColor = nameColor;
    await user.save();
    console.info(`[Shop] Name color equipped: user=${userId} color=${nameColor}`);
    res.json({ success: true, equippedNameColor: nameColor });
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

exports.equipProfilePicture = async (req, res) => {
  try {
    const { userId } = req.params;
    const { profilePicture } = req.body; // string itemId, or null to unequip

    if (profilePicture !== null && typeof profilePicture !== "string") {
      return res.status(400).json({
        success: false,
        error: "profilePicture must be string or null",
      });
    }

    const user = await User.findById(userId).select(
      "ownedProfilePictures equippedProfilePicture",
    );
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    if (
      profilePicture !== null &&
      !(user.ownedProfilePictures || []).includes(profilePicture)
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Profile picture not owned" });
    }

    user.equippedProfilePicture = profilePicture;
    await user.save();
    console.info(
      `[Shop] Profile picture equipped: user=${userId} pic=${profilePicture}`,
    );
    res.json({ success: true, equippedProfilePicture: profilePicture });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
