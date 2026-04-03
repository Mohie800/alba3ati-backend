/**
 * Migration script for the Frame Tiers feature.
 *
 * 1. Updates existing 8 legendary frames with rarity/frameType/frameData
 * 2. Seeds common (solid color) frames
 * 3. Seeds rare (gradient) frames
 *
 * Usage:
 *   cd alba3ati-backend
 *   node scripts/migrateFrameTiers.js
 *
 * Safe to run multiple times (idempotent).
 */

const mongoose = require("mongoose");
const dotenv = require("dotenv");
dotenv.config();

const ShopItem = require("../src/api/models/shopItem.model");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/madb";

// Update existing legendary image frames
const LEGENDARY_UPDATES = [
  { itemId: "wings1", frameData: { widthMult: 2.8, heightMult: 1.6 } },
];

// New common (solid color) frames
const COMMON_SEEDS = [
  {
    itemId: "color_red",
    name: "إطار أحمر",
    price: 20,
    sortOrder: 100,
    rarity: "common",
    frameType: "color",
    frameData: { color: "#E74C3C", borderWidth: 3 },
  },
  {
    itemId: "color_blue",
    name: "إطار أزرق",
    price: 20,
    sortOrder: 101,
    rarity: "common",
    frameType: "color",
    frameData: { color: "#3498DB", borderWidth: 3 },
  },
  {
    itemId: "color_green",
    name: "إطار أخضر",
    price: 20,
    sortOrder: 102,
    rarity: "common",
    frameType: "color",
    frameData: { color: "#27AE60", borderWidth: 3 },
  },
  {
    itemId: "color_gold",
    name: "إطار ذهبي",
    price: 30,
    sortOrder: 103,
    rarity: "common",
    frameType: "color",
    frameData: { color: "#F1C40F", borderWidth: 3 },
  },
  {
    itemId: "color_purple",
    name: "إطار بنفسجي",
    price: 20,
    sortOrder: 104,
    rarity: "common",
    frameType: "color",
    frameData: { color: "#8E44AD", borderWidth: 3 },
  },
];

// New rare (gradient) frames
const RARE_SEEDS = [
  {
    itemId: "gradient_sunset",
    name: "غروب",
    price: 60,
    sortOrder: 200,
    rarity: "rare",
    frameType: "gradient",
    frameData: { colors: ["#FF6B35", "#F1C40F"], borderWidth: 3 },
  },
  {
    itemId: "gradient_ocean",
    name: "محيط",
    price: 60,
    sortOrder: 201,
    rarity: "rare",
    frameType: "gradient",
    frameData: { colors: ["#3498DB", "#1ABC9C"], borderWidth: 3 },
  },
  {
    itemId: "gradient_fire",
    name: "لهب",
    price: 75,
    sortOrder: 202,
    rarity: "rare",
    frameType: "gradient",
    frameData: { colors: ["#E74C3C", "#F39C12"], borderWidth: 3 },
  },
  {
    itemId: "gradient_royal",
    name: "ملكي",
    price: 75,
    sortOrder: 203,
    rarity: "rare",
    frameType: "gradient",
    frameData: { colors: ["#8E44AD", "#3498DB"], borderWidth: 3 },
  },
];

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  // 1. Update existing legendary frames
  let updated = 0;
  for (const u of LEGENDARY_UPDATES) {
    const result = await ShopItem.updateOne(
      { itemId: u.itemId },
      {
        $set: {
          rarity: "legendary",
          frameType: "image",
          frameData: u.frameData,
        },
      },
    );
    if (result.modifiedCount > 0) updated++;
  }
  console.log(
    `Updated ${updated} legendary frames (${LEGENDARY_UPDATES.length} total)`,
  );

  // 2. Seed common frames (skip existing)
  let commonSeeded = 0;
  for (const seed of COMMON_SEEDS) {
    const exists = await ShopItem.findOne({ itemId: seed.itemId });
    if (!exists) {
      await ShopItem.create(seed);
      commonSeeded++;
    }
  }
  console.log(
    `Seeded ${commonSeeded} common frames (${COMMON_SEEDS.length} total)`,
  );

  // 3. Seed rare frames (skip existing)
  let rareSeeded = 0;
  for (const seed of RARE_SEEDS) {
    const exists = await ShopItem.findOne({ itemId: seed.itemId });
    if (!exists) {
      await ShopItem.create(seed);
      rareSeeded++;
    }
  }
  console.log(`Seeded ${rareSeeded} rare frames (${RARE_SEEDS.length} total)`);

  await mongoose.disconnect();
  console.log("Done.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
