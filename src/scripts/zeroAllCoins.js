const mongoose = require("mongoose");
const config = require("../config/config");
const User = require("../api/models/user.model");
const CoinTransaction = require("../api/models/coinTransaction.model");

async function zeroAllCoins() {
  try {
    await mongoose.connect(config.mongo.uri);
    console.log("Connected to MongoDB");

    // 1. Find all players with coins > 0
    const players = await User.find({ coins: { $gt: 0 } }).select("_id name coins");

    console.log(`Found ${players.length} players with coins > 0\n`);

    if (players.length === 0) {
      console.log("Nothing to do — all players already have 0 coins.");
      process.exit(0);
    }

    // 2. Log each player before zeroing
    let totalCoins = 0;
    for (const p of players) {
      console.log(`  ${p.name} — ${p.coins} coins`);
      totalCoins += p.coins;
    }
    console.log(`\nTotal coins to zero: ${totalCoins}`);

    // 3. Create audit transactions for each player
    const transactions = players.map((p) => ({
      user: p._id,
      amount: -p.coins,
      balance: 0,
      type: "admin_adjust",
      meta: { reason: "Bulk zero-out all player coins" },
    }));

    await CoinTransaction.insertMany(transactions);
    console.log(`Created ${transactions.length} audit transactions`);

    // 4. Zero out all coins
    const result = await User.updateMany(
      { coins: { $gt: 0 } },
      { $set: { coins: 0 } }
    );

    console.log(`\nZeroed ${result.modifiedCount} players`);

    // 5. Summary
    console.log("\n--- Summary ---");
    console.log(`Players affected:  ${players.length}`);
    console.log(`Total coins removed: ${totalCoins}`);
    console.log("Done.");

    process.exit(0);
  } catch (err) {
    console.error("Zero coins failed:", err.message);
    process.exit(1);
  }
}

zeroAllCoins();
