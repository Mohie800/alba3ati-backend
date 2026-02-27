const express = require("express");
const router = express.Router();
const adminAuth = require("../middleware/adminAuth");
const adminController = require("../controllers/admin.controller");
const statsController = require("../controllers/stats.controller");
const contactController = require("../controllers/contact.controller");
const banController = require("../controllers/ban.controller");
const reportController = require("../controllers/report.controller");
const appSettingsController = require("../controllers/appSettings.controller");

// Public
router.post("/login", adminController.login);

// Protected
router.get("/profile", adminAuth, adminController.getProfile);
router.get("/stats", adminAuth, statsController.getDashboardStats);
router.get("/players", adminAuth, statsController.getPlayers);
router.get("/players/:id", adminAuth, statsController.getPlayerDetail);
router.get("/games", adminAuth, statsController.getGames);
router.get("/games/:id", adminAuth, statsController.getGameDetail);
router.get("/contacts", adminAuth, contactController.getContacts);
router.get("/contacts/:id", adminAuth, contactController.getContactDetail);
router.put("/contacts/:id/respond", adminAuth, contactController.respondToContact);

// Reports
router.get("/reports", adminAuth, reportController.getReports);
router.get("/reports/:id", adminAuth, reportController.getReportDetail);
router.put("/reports/:id/resolve", adminAuth, reportController.resolveReport);

// Bans
router.post("/bans", adminAuth, banController.banDevice);
router.get("/bans", adminAuth, banController.listBans);
router.get("/bans/:deviceId", adminAuth, banController.checkDevice);
router.delete("/bans/:deviceId", adminAuth, banController.unbanDevice);

// App Settings
router.get("/app-settings", adminAuth, appSettingsController.getSettings);
router.put("/app-settings", adminAuth, appSettingsController.updateSettings);

module.exports = router;
