const express = require("express");
const router = express.Router();
const appSettingsController = require("../controllers/appSettings.controller");

// Public — mobile app calls this on startup
router.get("/check-update", appSettingsController.checkUpdate);

module.exports = router;
