const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const ShopItem = require("../models/shopItem.model");
const User = require("../models/user.model");
const CoinTransaction = require("../models/coinTransaction.model");

const shopItemsDir = path.join(process.cwd(), "uploads", "shop-items");
if (!fs.existsSync(shopItemsDir)) {
  fs.mkdirSync(shopItemsDir, { recursive: true });
}

/**
 * Resize an uploaded image buffer to a square, convert to WebP, and write it
 * to the shop-items upload dir. Returns the relative URL to store on the item.
 * Keeps files small + uniform for fast mobile loading.
 */
async function processShopImage(buffer) {
  const filename =
    Date.now() + "-" + Math.round(Math.random() * 1e9) + ".webp";
  const outPath = path.join(shopItemsDir, filename);
  await sharp(buffer)
    .rotate() // honour EXIF orientation before stripping metadata
    .resize(512, 512, { fit: "cover", position: "centre" })
    .webp({ quality: 80 })
    .toFile(outPath);
  return "/uploads/shop-items/" + filename;
}

function deleteImageFile(imageUrl) {
  if (!imageUrl) return;
  const p = path.join(process.cwd(), imageUrl);
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch (e) {
      console.error("Failed to delete shop image:", p, e.message);
    }
  }
}

exports.getShopItems = async (req, res) => {
  try {
    const items = await ShopItem.find().sort({ sortOrder: 1 });
    res.json({ success: true, data: { items } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function validateItemPayload({ type, frameType, frameData }) {
  if (type === "profilePicture") {
    // Image presence is validated in the controller (depends on req.file / existing item)
    return null;
  }
  if (type === "nameColor") {
    if (frameType !== "color") {
      return "nameColor items must have frameType 'color'";
    }
    if (!frameData || typeof frameData.color !== "string" || !HEX_RE.test(frameData.color)) {
      return "frameData.color (#RRGGBB hex) is required for nameColor items";
    }
    return null;
  }
  if (frameType === "color" && (!frameData || !frameData.color)) {
    return "frameData.color is required for color frames";
  }
  if (frameType === "gradient" && (!frameData || !Array.isArray(frameData.colors) || frameData.colors.length < 2)) {
    return "frameData.colors (array of 2+) is required for gradient frames";
  }
  return null;
}

// Multipart form fields arrive as strings; coerce the typed ones in place.
function coerceItemBody(body) {
  const out = { ...body };
  // Empty price → NaN so create-validation rejects it; on update NaN is skipped.
  if (out.price !== undefined) out.price = out.price === "" ? NaN : Number(out.price);
  if (out.sortOrder !== undefined) out.sortOrder = out.sortOrder === "" ? 0 : Number(out.sortOrder);
  // Normalise string ("true"/"false") and boolean; leave undefined untouched so
  // partial updates don't accidentally toggle the item off.
  if (out.isActive !== undefined) out.isActive = out.isActive === true || out.isActive === "true";
  if (typeof out.frameData === "string") {
    try {
      out.frameData = JSON.parse(out.frameData);
    } catch {
      out.frameData = {};
    }
  }
  return out;
}

exports.createShopItem = async (req, res) => {
  try {
    const { itemId, type, name, price, isActive, sortOrder, rarity, frameType, frameData } =
      coerceItemBody(req.body);

    if (!itemId || !name || price == null || Number.isNaN(price)) {
      return res.status(400).json({ success: false, message: "itemId, name, and price are required" });
    }

    if (type === "profilePicture") {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "Image is required for profile pictures" });
      }
      const imageUrl = await processShopImage(req.file.buffer);
      const item = await ShopItem.create({
        itemId,
        type,
        name,
        price,
        isActive,
        sortOrder,
        rarity,
        imageUrl,
      });
      return res.json({ success: true, data: { item } });
    }

    const validationErr = validateItemPayload({ type, frameType, frameData });
    if (validationErr) {
      return res.status(400).json({ success: false, message: validationErr });
    }
    const item = await ShopItem.create({ itemId, type, name, price, isActive, sortOrder, rarity, frameType, frameData });
    res.json({ success: true, data: { item } });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Item with this ID already exists" });
    }
    console.error("Create shop item error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateShopItem = async (req, res) => {
  try {
    const existing = await ShopItem.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    const { type, name, price, isActive, sortOrder, rarity, frameType, frameData } =
      coerceItemBody(req.body);
    const effectiveType = type || existing.type;

    if (effectiveType === "profilePicture") {
      const update = { type: "profilePicture" };
      if (name !== undefined) update.name = name;
      if (price !== undefined && !Number.isNaN(price)) update.price = price;
      if (isActive !== undefined) update.isActive = isActive;
      if (sortOrder !== undefined && !Number.isNaN(sortOrder)) update.sortOrder = sortOrder;
      if (rarity !== undefined) update.rarity = rarity;
      if (req.file) {
        // Process+write the new image first; only delete the old one once that
        // succeeds, so a sharp/disk failure can't orphan the DB record.
        const newImageUrl = await processShopImage(req.file.buffer);
        deleteImageFile(existing.imageUrl);
        update.imageUrl = newImageUrl;
      }
      const item = await ShopItem.findByIdAndUpdate(req.params.id, update, {
        new: true,
        runValidators: true,
      });
      return res.json({ success: true, data: { item } });
    }

    const validationErr = validateItemPayload({ type, frameType, frameData });
    if (validationErr) {
      return res.status(400).json({ success: false, message: validationErr });
    }
    const item = await ShopItem.findByIdAndUpdate(
      req.params.id,
      { type, name, price, isActive, sortOrder, rarity, frameType, frameData },
      { new: true, runValidators: true },
    );
    res.json({ success: true, data: { item } });
  } catch (err) {
    console.error("Update shop item error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteShopItem = async (req, res) => {
  try {
    const item = await ShopItem.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }
    deleteImageFile(item.imageUrl);
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
