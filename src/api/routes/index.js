const express = require("express");
const router = express.Router();

// Auth routes
router.use("/auth", require("./auth.route"));
router.use("/rooms", require("./room.route"));
router.use("/admin", require("./admin.route"));
router.use("/contact", require("./contact.route"));
router.use("/notifications", require("./notification.route"));
router.use("/reports", require("./report.route"));
router.use("/app", require("./app.route"));
router.use("/livekit", require("./livekit.route"));
router.use("/leaderboard", require("./leaderboard.route"));
router.use("/friends", require("./friends.routes"));
router.use("/coins", require("./coins.route"));
router.use("/shop", require("./shop.route"));

module.exports = router;
