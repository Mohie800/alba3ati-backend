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
        .select("name stats")
        .lean(),
      User.countDocuments({ "stats.gamesPlayed": { $gt: 0 } }),
    ]);

    const leaderboard = players.map((player, index) => ({
      _id: player._id,
      rank: skip + index + 1,
      name: player.name,
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
