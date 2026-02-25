const express = require("express");
const router = express.Router();

// Auth routes
router.use("/auth", require("./auth.route"));
router.use("/rooms", require("./room.route"));

module.exports = router;
