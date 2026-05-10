const mongoose = require("mongoose");
const config = require("../config/config");
const ShopItem = require("../api/models/shopItem.model");

const NAME_COLORS = [
  { itemId: "crimson",   name: "كرز",        price: 100, rarity: "common",    color: "#C0392B", sortOrder: 100 },
  { itemId: "goldenrod", name: "كهرماني",    price: 100, rarity: "common",    color: "#D4A017", sortOrder: 101 },
  { itemId: "forest",    name: "أخضر غابة",  price: 100, rarity: "common",    color: "#27AE60", sortOrder: 102 },
  { itemId: "slate",     name: "فحمي",       price: 100, rarity: "common",    color: "#7F8C8D", sortOrder: 103 },
  { itemId: "royal",     name: "ملكي",       price: 250, rarity: "rare",      color: "#2E86DE", sortOrder: 110 },
  { itemId: "magenta",   name: "مجنتا",      price: 250, rarity: "rare",      color: "#D63384", sortOrder: 111 },
  { itemId: "teal",      name: "فيروزي",     price: 250, rarity: "rare",      color: "#16A085", sortOrder: 112 },
  { itemId: "amber",     name: "عنبر",       price: 250, rarity: "rare",      color: "#E67E22", sortOrder: 113 },
  { itemId: "phoenix",   name: "فينيق",      price: 600, rarity: "legendary", color: "#FF4757", sortOrder: 120 },
  { itemId: "aurora",    name: "الشفق",      price: 600, rarity: "legendary", color: "#1ABC9C", sortOrder: 121 },
  { itemId: "nebula",    name: "السديم",     price: 600, rarity: "legendary", color: "#9B59B6", sortOrder: 122 },
  { itemId: "solar",     name: "شمسي",       price: 600, rarity: "legendary", color: "#FFC312", sortOrder: 123 },
];

async function seedNameColors() {
  try {
    await mongoose.connect(config.mongo.uri);
    console.log("Connected to MongoDB");

    let inserted = 0;
    let updated = 0;
    for (const c of NAME_COLORS) {
      const existing = await ShopItem.findOne({ itemId: c.itemId });
      const doc = {
        itemId: c.itemId,
        type: "nameColor",
        name: c.name,
        price: c.price,
        rarity: c.rarity,
        frameType: "color",
        frameData: { color: c.color },
        isActive: true,
        sortOrder: c.sortOrder,
      };
      if (existing) {
        await ShopItem.updateOne({ itemId: c.itemId }, doc);
        updated++;
        console.log(`  updated: ${c.itemId} (${c.color})`);
      } else {
        await ShopItem.create(doc);
        inserted++;
        console.log(`  inserted: ${c.itemId} (${c.color})`);
      }
    }

    console.log(`\nDone. Inserted ${inserted}, updated ${updated}.`);
    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exit(1);
  }
}

seedNameColors();
