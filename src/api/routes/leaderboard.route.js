const express = require("express");
const router = express.Router();
const leaderboardController = require("../controllers/leaderboard.controller");

// GET /api/leaderboard?page=1&limit=20
router.get("/", leaderboardController.getLeaderboard);
// GET /api/leaderboard/weekly?page=1&limit=20&userId=
router.get("/weekly", leaderboardController.getWeeklyLeaderboard);

module.exports = router;
