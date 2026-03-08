const express = require("express");
const router = express.Router();
const leaderboardController = require("../controllers/leaderboard.controller");

// GET /api/leaderboard?page=1&limit=20
router.get("/", leaderboardController.getLeaderboard);

module.exports = router;
