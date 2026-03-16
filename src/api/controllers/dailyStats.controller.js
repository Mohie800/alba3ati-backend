const DailyStats = require("../models/dailyStats.model");

// GET /api/admin/daily-stats?days=30
exports.getDailyStats = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString().slice(0, 10);

    const stats = await DailyStats.find({ date: { $gte: startStr } })
      .sort({ date: 1 })
      .lean();

    // Transform: replace activeUsers array with count
    const data = stats.map((s) => ({
      date: s.date,
      newUsers: s.newUsers,
      gamesPlayed: s.gamesPlayed,
      quickPlayGames: s.quickPlayGames,
      privateGames: s.privateGames,
      publicGames: s.publicGames,
      activeUsers: s.activeUsers ? s.activeUsers.length : 0,
      avgPlayersPerGame:
        s.gamesPlayed > 0
          ? Math.round((s.totalPlayersInGames / s.gamesPlayed) * 10) / 10
          : 0,
      peakConcurrent: s.peakConcurrent,
      gameResults: s.gameResults,
    }));

    // Summary totals
    const totals = data.reduce(
      (acc, d) => {
        acc.newUsers += d.newUsers;
        acc.gamesPlayed += d.gamesPlayed;
        acc.activeUsers += d.activeUsers;
        acc.peakConcurrent = Math.max(acc.peakConcurrent, d.peakConcurrent);
        return acc;
      },
      { newUsers: 0, gamesPlayed: 0, activeUsers: 0, peakConcurrent: 0 }
    );

    res.json({ success: true, data: { days, totals, daily: data } });
  } catch (err) {
    console.error("Error fetching daily stats:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
