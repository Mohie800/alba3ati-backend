/**
 * Backfill player stats from existing ended games.
 * Run once after deployment: node src/scripts/backfillStats.js
 */
const mongoose = require("mongoose");
const config = require("../config/config");
const Room = require("../api/models/room.model");
const User = require("../api/models/user.model");
const { didPlayerWin } = require("../api/game/statsUpdate.game");

async function backfill() {
  await mongoose.connect(config.mongo.uri);
  console.log("Connected to MongoDB");

  // Reset all stats first
  await User.updateMany(
    {},
    {
      $set: {
        "stats.gamesPlayed": 0,
        "stats.gamesWon": 0,
        "stats.gamesLost": 0,
        "stats.gamesDraw": 0,
        "stats.totalKills": 0,
        "stats.totalNightsSurvived": 0,
        "stats.currentWinStreak": 0,
        "stats.bestWinStreak": 0,
      },
    },
  );
  console.log("Reset all user stats");

  const rooms = await Room.find({
    status: "ended",
    gameResult: { $ne: null },
  }).lean();

  console.log(`Found ${rooms.length} ended games to process`);

  // Accumulate stats per player
  const playerStats = new Map();

  for (const room of rooms) {
    for (const p of room.players) {
      if (!p.roleId) continue;
      const playerId = p.player.toString();
      const outcome = didPlayerWin(p.roleId, room.gameResult);

      if (!playerStats.has(playerId)) {
        playerStats.set(playerId, {
          gamesPlayed: 0,
          gamesWon: 0,
          gamesLost: 0,
          gamesDraw: 0,
          totalKills: 0,
          totalNightsSurvived: 0,
          // Track game outcomes in order for streak calculation
          outcomes: [],
        });
      }

      const stats = playerStats.get(playerId);
      stats.gamesPlayed++;
      stats.totalKills += p.kills || 0;
      stats.totalNightsSurvived += (p.night || 1) - 1;
      stats.outcomes.push(outcome);

      if (outcome === "win") stats.gamesWon++;
      else if (outcome === "loss") stats.gamesLost++;
      else stats.gamesDraw++;
    }
  }

  console.log(`Computed stats for ${playerStats.size} players`);

  // Calculate streaks and bulk update
  const bulkOps = [];
  for (const [playerId, stats] of playerStats) {
    let currentStreak = 0;
    let bestStreak = 0;

    for (const outcome of stats.outcomes) {
      if (outcome === "win") {
        currentStreak++;
        if (currentStreak > bestStreak) bestStreak = currentStreak;
      } else if (outcome === "loss") {
        currentStreak = 0;
      }
      // draw preserves streak
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(playerId) },
        update: {
          $set: {
            "stats.gamesPlayed": stats.gamesPlayed,
            "stats.gamesWon": stats.gamesWon,
            "stats.gamesLost": stats.gamesLost,
            "stats.gamesDraw": stats.gamesDraw,
            "stats.totalKills": stats.totalKills,
            "stats.totalNightsSurvived": stats.totalNightsSurvived,
            "stats.currentWinStreak": currentStreak,
            "stats.bestWinStreak": bestStreak,
          },
        },
      },
    });
  }

  if (bulkOps.length > 0) {
    const result = await User.bulkWrite(bulkOps);
    console.log(`Updated ${result.modifiedCount} users`);
  }

  console.log("Backfill complete!");
  await mongoose.disconnect();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
