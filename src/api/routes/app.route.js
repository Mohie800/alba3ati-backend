const express = require("express");
const router = express.Router();
const appSettingsController = require("../controllers/appSettings.controller");
const adController = require("../controllers/ad.controller");

// Public — mobile app calls this on startup
router.get("/check-update", appSettingsController.checkUpdate);
router.get("/community-links", appSettingsController.getCommunityLinks);
router.get("/ads", adController.getActiveAds);

module.exports = router;
