const DailyStats = require("../models/dailyStats.model");
const Room = require("../models/room.model");

// Day boundaries follow the players' local time, not UTC
const STATS_TZ = "Africa/Khartoum";
const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: STATS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: STATS_TZ,
  hour: "2-digit",
  hourCycle: "h23",
});

function getToday() {
  return dayFmt.format(new Date()); // "YYYY-MM-DD"
}

function getHour() {
  return hourFmt.format(new Date()).padStart(2, "0"); // "00".."23"
}

// Called when a game ends — increments game counts and tracks active players
async function recordGameEnd(room, gameResult) {
  try {
    const date = getToday();

    // Collect unique player IDs from this game
    const playerIds = room.players.filter((p) => p.player).map((p) =>
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

    if ((room.gamesCompleted || 0) > 1) inc.rematchGames = 1;

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

// One write per user per day; the set resets when the date rolls over
let appUserDay = null;
const appUsersSeen = new Set();
function recordAppUser(userId) {
  const date = getToday();
  if (date !== appUserDay) {
    appUserDay = date;
    appUsersSeen.clear();
  }
  const id = String(userId);
  if (appUsersSeen.has(id)) return;
  appUsersSeen.add(id);
  DailyStats.updateOne(
    { date },
    { $addToSet: { appUsers: userId } },
    { upsert: true },
  ).catch((err) => {
    appUsersSeen.delete(id);
    console.error("Error recording app user:", err);
  });
}

async function countPlayersInGames() {
  const [row] = await Room.aggregate([
    { $match: { status: "playing" } },
    {
      $project: {
        n: {
          $size: {
            $filter: {
              input: "$players",
              cond: { $ne: ["$$this.leftMidGame", true] },
            },
          },
        },
      },
    },
    { $group: { _id: null, total: { $sum: "$n" } } },
  ]);
  return row ? row.total : 0;
}

// Sampled on an interval from the socket loader
async function sampleConcurrency(onlineUsers) {
  try {
    const inGame = await countPlayersInGames();
    const hour = getHour();
    await DailyStats.updateOne(
      { date: getToday() },
      {
        $max: {
          peakOnlineUsers: onlineUsers,
          peakInGame: inGame,
          [`hourly.${hour}.online`]: onlineUsers,
          [`hourly.${hour}.inGame`]: inGame,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    console.error("Error sampling concurrency:", error);
  }
}

module.exports = {
  recordGameEnd,
  recordNewUser,
  updatePeakConcurrent,
  recordAppUser,
  sampleConcurrency,
  countPlayersInGames,
  getToday,
  STATS_TZ,
};
