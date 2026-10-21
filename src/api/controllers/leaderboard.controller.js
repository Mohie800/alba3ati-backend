const User = require("../models/user.model");

exports.getLeaderboard = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [players, total] = await Promise.all([
      User.find({ "stats.gamesPlayed": { $gt: 0 } })
        .sort({ "stats.gamesWon": -1, "stats.gamesPlayed": 1 })
        .skip(skip)
        .limit(limit)
        .select("name stats frame nameColor equippedProfilePicture")
        .lean(),
      User.countDocuments({ "stats.gamesPlayed": { $gt: 0 } }),
    ]);

    const leaderboard = players.map((player, index) => ({
      _id: player._id,
      rank: skip + index + 1,
      name: player.name,
      frame: player.frame || null,
      nameColor: player.nameColor || null,
      equippedProfilePicture: player.equippedProfilePicture || null,
      gamesPlayed: player.stats?.gamesPlayed || 0,
      gamesWon: player.stats?.gamesWon || 0,
      gamesLost: player.stats?.gamesLost || 0,
      gamesDraw: player.stats?.gamesDraw || 0,
      totalKills: player.stats?.totalKills || 0,
      totalNightsSurvived: player.stats?.totalNightsSurvived || 0,
      currentWinStreak: player.stats?.currentWinStreak || 0,
      bestWinStreak: player.stats?.bestWinStreak || 0,
      winRate:
        player.stats?.gamesPlayed > 0
          ? Math.round(
              (player.stats.gamesWon / player.stats.gamesPlayed) * 100,
            )
          : 0,
    }));

    res.json({
      success: true,
      data: {
        leaderboard,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch leaderboard" });
  }
};

const WeeklyScore = require("../models/weeklyScore.model");
const WeeklyResult = require("../models/weeklyResult.model");
const AppSettings = require("../models/appSettings.model");
const mongoose = require("mongoose");
const weekly = require("../services/weeklyLeaderboard.service");

const publicPlayer = (u) => ({
  _id: u._id,
  name: u.name,
  frame: u.frame || null,
  nameColor: u.nameColor || null,
  equippedProfilePicture: u.equippedProfilePicture || null,
});

const WINNER_FIELDS = "name frame nameColor equippedProfilePicture";

// GET /api/leaderboard/weekly?page=1&limit=20&userId=
exports.getWeeklyLeaderboard = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const week = weekly.weekKey();
    const { startsAt, endsAt } = weekly.weekBounds(week);
    const userId = mongoose.isValidObjectId(req.query.userId) ? req.query.userId : null;

    const [settings, rows, total, me, lastResult] = await Promise.all([
      AppSettings.getSettings(),
      weekly.getRanking(week, skip, limit),
      WeeklyScore.countDocuments({ week, wins: { $gt: 0 } }),
      userId ? weekly.getPlayerRank(week, userId) : null,
      page === 1
        ? WeeklyResult.findOne({ week: weekly.previousWeekKey(week) })
            .populate("winners.user", WINNER_FIELDS)
            .lean()
        : null,
    ]);

    const leaderboard = rows
      .filter((r) => r.user)
      .map((r, i) => ({
        ...publicPlayer(r.user),
        rank: skip + i + 1,
        wins: r.wins,
        games: r.games,
      }));

    const lastWeek = lastResult
      ? {
          week: lastResult.week,
          winners: lastResult.winners
            .filter((w) => w.user)
            .map((w) => ({
              ...publicPlayer(w.user),
              rank: w.rank,
              wins: w.wins,
              coins: w.coins,
            })),
        }
      : null;

    res.json({
      success: true,
      data: {
        week,
        startsAt,
        endsAt,
        serverNow: new Date(),
        enabled: settings.weeklyLeaderboard?.enabled !== false,
        rewards: weekly.rewardAmounts(settings),
        leaderboard,
        me,
        lastWeek,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    console.error("Weekly leaderboard error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch weekly leaderboard" });
  }
};

// GET /api/admin/weekly-leaderboard?page=1 — live top 10 plus past weeks' winners
exports.adminWeekly = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const week = weekly.weekKey();

    const [current, players, results, totalResults] = await Promise.all([
      weekly.getRanking(week, 0, 10),
      WeeklyScore.countDocuments({ week }),
      WeeklyResult.find()
        .sort({ week: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("winners.user", "name")
        .lean(),
      WeeklyResult.countDocuments(),
    ]);

    res.json({
      success: true,
      data: {
        week,
        ...weekly.weekBounds(week),
        players,
        current: current
          .filter((r) => r.user)
          .map((r, i) => ({
            rank: i + 1,
            user: { _id: r.user._id, name: r.user.name },
            wins: r.wins,
            games: r.games,
          })),
        results,
        pagination: {
          page,
          limit,
          total: totalResults,
          totalPages: Math.ceil(totalResults / limit),
        },
      },
    });
  } catch (error) {
    console.error("Admin weekly leaderboard error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch weekly leaderboard" });
  }
};
