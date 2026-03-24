const User = require("../models/user.model");

// Determines if a player won based on their roleId and the gameResult
function didPlayerWin(roleId, gameResult) {
  if (gameResult === "0") return "draw";
  if (roleId === "1" && gameResult === "1") return "win";
  if (roleId === "7" && gameResult === "1") return "win";
  if (["2", "3", "4", "6"].includes(roleId) && gameResult === "2") return "win";
  if (roleId === "5" && gameResult === "3") return "win";
  return "loss";
}

// Updates stats for all players in a room after game ends
async function updatePlayerStats(room, gameResult) {
  try {
    const bulkOps = [];

    for (const p of room.players) {
      const playerId =
        typeof p.player === "object" && p.player._id
          ? p.player._id
          : p.player;
      const outcome = didPlayerWin(p.roleId, gameResult);

      const inc = {
        "stats.gamesPlayed": 1,
        "stats.totalKills": p.kills || 0,
        "stats.totalNightsSurvived": (p.night || 1) - 1,
      };

      if (outcome === "win") {
        inc["stats.gamesWon"] = 1;
      } else if (outcome === "loss") {
        inc["stats.gamesLost"] = 1;
      } else {
        inc["stats.gamesDraw"] = 1;
      }

      bulkOps.push({
        updateOne: {
          filter: { _id: playerId },
          update: { $inc: inc },
        },
      });
    }

    if (bulkOps.length > 0) {
      await User.bulkWrite(bulkOps);
    }

    // Handle win streaks separately (needs current values)
    const playerIds = room.players.map((p) =>
      typeof p.player === "object" && p.player._id ? p.player._id : p.player,
    );
    const users = await User.find({ _id: { $in: playerIds } });
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const streakOps = [];
    for (const p of room.players) {
      const playerId = (
        typeof p.player === "object" && p.player._id
          ? p.player._id
          : p.player
      ).toString();
      const outcome = didPlayerWin(p.roleId, gameResult);
      const user = userMap.get(playerId);
      if (!user) continue;

      const currentStreak = user.stats?.currentWinStreak || 0;
      const bestStreak = user.stats?.bestWinStreak || 0;

      if (outcome === "win") {
        const newStreak = currentStreak + 1;
        const update = { "stats.currentWinStreak": newStreak };
        if (newStreak > bestStreak) {
          update["stats.bestWinStreak"] = newStreak;
        }
        streakOps.push({
          updateOne: {
            filter: { _id: user._id },
            update: { $set: update },
          },
        });
      } else if (outcome === "loss") {
        streakOps.push({
          updateOne: {
            filter: { _id: user._id },
            update: { $set: { "stats.currentWinStreak": 0 } },
          },
        });
      }
      // draw: preserve current streak (no op)
    }

    if (streakOps.length > 0) {
      await User.bulkWrite(streakOps);
    }
  } catch (error) {
    console.error("Error updating player stats:", error);
  }
}

module.exports = { didPlayerWin, updatePlayerStats };
