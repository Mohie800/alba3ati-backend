/**
 * Migration script for the Coin System feature.
 *
 * 1. Grandfathers existing users: adds their current `frame` to `ownedFrames`
 * 2. Seeds ShopItem documents for all 8 frame IDs with initial prices
 *
 * Usage:
 *   cd alba3ati-backend
 *   node scripts/migrateCoinSystem.js
 *
 * Safe to run multiple times (idempotent).
 */

const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const User = require("../src/api/models/user.model");
const ShopItem = require("../src/api/models/shopItem.model");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/madb";

const FRAME_SEEDS = [
  { itemId: "wings1", name: "أجنحة النسر", price: 150, sortOrder: 3 },
];

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  // 1. Grandfather existing frames into ownedFrames
  const usersWithFrame = await User.find({
    frame: { $ne: null, $exists: true },
  }).select("_id frame ownedFrames");

  let grandfathered = 0;
  for (const user of usersWithFrame) {
    if (!user.ownedFrames.includes(user.frame)) {
      await User.updateOne(
        { _id: user._id },
        { $addToSet: { ownedFrames: user.frame } },
      );
      grandfathered++;
    }
  }
  console.log(
    `Grandfathered ${grandfathered} users (${usersWithFrame.length} had frames)`,
  );

  // 2. Seed ShopItem documents (skip existing)
  let seeded = 0;
  for (const seed of FRAME_SEEDS) {
    const exists = await ShopItem.findOne({ itemId: seed.itemId });
    if (!exists) {
      await ShopItem.create(seed);
      seeded++;
    }
  }
  console.log(`Seeded ${seeded} shop items (${FRAME_SEEDS.length} total)`);

  await mongoose.disconnect();
  console.log("Done.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
