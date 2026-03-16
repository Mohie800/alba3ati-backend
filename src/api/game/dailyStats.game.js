const DailyStats = require("../models/dailyStats.model");

function getToday() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// Called when a game ends — increments game counts and tracks active players
async function recordGameEnd(room, gameResult) {
  try {
    const date = getToday();

    // Collect unique player IDs from this game
    const playerIds = room.players.map((p) =>
      typeof p.player === "object" && p.player._id ? p.player._id : p.player
    );

    const resultField = {
      "1": "gameResults.ba3atiWins",
      "2": "gameResults.villagerWins",
      "3": "gameResults.abuJanzeerWins",
      "0": "gameResults.draws",
    }[gameResult];

    const inc = { gamesPlayed: 1, totalPlayersInGames: playerIds.length };
    if (resultField) inc[resultField] = 1;

    if (room.isQuickPlay) {
      inc.quickPlayGames = 1;
    } else if (room.isPublic) {
      inc.publicGames = 1;
    } else {
      inc.privateGames = 1;
    }

    await DailyStats.findOneAndUpdate(
      { date },
      {
        $inc: inc,
        $addToSet: { activeUsers: { $each: playerIds } },
      },
      { upsert: true }
    );
  } catch (error) {
    console.error("Error recording daily stats:", error);
  }
}

// Called when a new user registers
async function recordNewUser() {
  try {
    await DailyStats.findOneAndUpdate(
      { date: getToday() },
      { $inc: { newUsers: 1 } },
      { upsert: true }
    );
  } catch (error) {
    console.error("Error recording new user stat:", error);
  }
}

// Called from socket.io on connection/disconnection to track peak concurrent
async function updatePeakConcurrent(currentCount) {
  try {
    await DailyStats.findOneAndUpdate(
      { date: getToday(), peakConcurrent: { $lt: currentCount } },
      { $set: { peakConcurrent: currentCount } },
      { upsert: false }
    );
    // If no doc exists yet for today, create it
    await DailyStats.findOneAndUpdate(
      { date: getToday() },
      { $max: { peakConcurrent: currentCount } },
      { upsert: true }
    );
  } catch (error) {
    console.error("Error updating peak concurrent:", error);
  }
}

module.exports = { recordGameEnd, recordNewUser, updatePeakConcurrent };
