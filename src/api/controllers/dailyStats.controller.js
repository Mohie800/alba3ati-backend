const DailyStats = require("../models/dailyStats.model");
const { STATS_TZ } = require("../game/dailyStats.game");

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: STATS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const uniqueCount = async (field, match) => {
  const [row] = await DailyStats.aggregate([
    { $match: match },
    { $unwind: `$${field}` },
    { $group: { _id: `$${field}` } },
    { $count: "n" },
  ]);
  return row ? row.n : 0;
};

// GET /api/admin/daily-stats?days=30
exports.getDailyStats = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);

    const startDate = new Date(Date.now() - days * 86400000);
    const startStr = dayFmt.format(startDate);
    const match = { date: { $gte: startStr } };

    const [stats, uniqueAppUsers, uniquePlayers] = await Promise.all([
      DailyStats.find(match).sort({ date: 1 }).lean(),
      uniqueCount("appUsers", match),
      uniqueCount("activeUsers", match),
    ]);

    // Transform: replace user arrays with counts
    const data = stats.map((s) => ({
      date: s.date,
      newUsers: s.newUsers,
      gamesPlayed: s.gamesPlayed,
      quickPlayGames: s.quickPlayGames,
      privateGames: s.privateGames,
      publicGames: s.publicGames,
      rematchGames: s.rematchGames || 0,
      // Players who finished at least one game
      activeUsers: s.activeUsers ? s.activeUsers.length : 0,
      // Signed-in users who opened the app (tracked since this field was added)
      appUsers: s.appUsers ? s.appUsers.length : 0,
      avgPlayersPerGame:
        s.gamesPlayed > 0
          ? Math.round((s.totalPlayersInGames / s.gamesPlayed) * 10) / 10
          : 0,
      peakConcurrent: s.peakConcurrent,
      peakOnlineUsers: s.peakOnlineUsers || 0,
      peakInGame: s.peakInGame || 0,
      gameResults: s.gameResults,
    }));

    const totals = data.reduce(
      (acc, d) => {
        acc.newUsers += d.newUsers;
        acc.gamesPlayed += d.gamesPlayed;
        acc.rematchGames += d.rematchGames;
        acc.activeUsers += d.activeUsers;
        acc.peakConcurrent = Math.max(acc.peakConcurrent, d.peakConcurrent);
        acc.peakOnlineUsers = Math.max(acc.peakOnlineUsers, d.peakOnlineUsers);
        acc.peakInGame = Math.max(acc.peakInGame, d.peakInGame);
        return acc;
      },
      {
        newUsers: 0,
        gamesPlayed: 0,
        rematchGames: 0,
        activeUsers: 0,
        peakConcurrent: 0,
        peakOnlineUsers: 0,
        peakInGame: 0,
      },
    );
    const daysWithAppData = data.filter((d) => d.appUsers > 0);
    totals.avgDailyAppUsers = daysWithAppData.length
      ? Math.round(
          daysWithAppData.reduce((n, d) => n + d.appUsers, 0) /
            daysWithAppData.length,
        )
      : 0;
    totals.avgDailyPlayers = data.length
      ? Math.round(data.reduce((n, d) => n + d.activeUsers, 0) / data.length)
      : 0;
    totals.uniqueAppUsers = uniqueAppUsers;
    totals.uniquePlayers = uniquePlayers;
    totals.rematchShare = totals.gamesPlayed
      ? Math.round((totals.rematchGames / totals.gamesPlayed) * 100)
      : 0;

    // Busiest level per hour across the period (local time)
    const hourly = Array.from({ length: 24 }, (_, h) => {
      const key = String(h).padStart(2, "0");
      let online = 0;
      let inGame = 0;
      for (const s of stats) {
        const slot = s.hourly?.[key];
        if (slot) {
          online = Math.max(online, slot.online || 0);
          inGame = Math.max(inGame, slot.inGame || 0);
        }
      }
      return { hour: key, online, inGame };
    });

    res.json({
      success: true,
      data: { days, timezone: STATS_TZ, totals, daily: data, hourly },
    });
  } catch (err) {
    console.error("Error fetching daily stats:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
