const express = require("express");
const router = express.Router();
const adminAuth = require("../middleware/adminAuth");
const adminController = require("../controllers/admin.controller");
const statsController = require("../controllers/stats.controller");
const contactController = require("../controllers/contact.controller");
const banController = require("../controllers/ban.controller");
const reportController = require("../controllers/report.controller");
const appSettingsController = require("../controllers/appSettings.controller");
const notificationController = require("../controllers/notification.controller");
const adController = require("../controllers/ad.controller");
const dailyStatsController = require("../controllers/dailyStats.controller");
const friendshipAdminController = require("../controllers/friendship.admin.controller");
const shopAdminController = require("../controllers/shop.admin.controller");
const upload = require("../middleware/upload");

// Public
router.post("/login", adminController.login);

// Protected
router.get("/profile", adminAuth, adminController.getProfile);
router.get("/stats", adminAuth, statsController.getDashboardStats);
router.get("/players", adminAuth, statsController.getPlayers);
router.get("/online-players", adminAuth, statsController.getOnlinePlayers);
router.get("/top-players-coins", adminAuth, statsController.getTopPlayersByCoins);
router.get("/players/:id", adminAuth, statsController.getPlayerDetail);
router.delete("/players/:id", adminAuth, statsController.deletePlayer);
router.patch(
  "/players/:id/frame",
  adminAuth,
  statsController.updatePlayerFrame,
);
router.get("/games", adminAuth, statsController.getGames);
router.get("/games/:id", adminAuth, statsController.getGameDetail);
router.get("/contacts", adminAuth, contactController.getContacts);
router.get("/contacts/:id", adminAuth, contactController.getContactDetail);
router.put(
  "/contacts/:id/respond",
  adminAuth,
  contactController.respondToContact,
);

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

// Notifications
router.post(
  "/notifications/send",
  adminAuth,
  notificationController.sendNotification,
);
router.get(
  "/notifications",
  adminAuth,
  notificationController.getNotifications,
);

// Ads
router.post("/ads", adminAuth, upload.single("image"), adController.createAd);
router.get("/ads", adminAuth, adController.getAds);
router.put(
  "/ads/:id",
  adminAuth,
  upload.single("image"),
  adController.updateAd,
);
router.delete("/ads/:id", adminAuth, adController.deleteAd);

// Daily Stats / Analytics
router.get("/daily-stats", adminAuth, dailyStatsController.getDailyStats);
router.get("/coin-stats", adminAuth, statsController.getCoinStats);

// Friendships (admin)
router.get(
  "/players/:id/friends",
  adminAuth,
  friendshipAdminController.getPlayerFriends,
);
router.delete(
  "/friendships/:id",
  adminAuth,
  friendshipAdminController.removeFriendship,
);
router.get(
  "/friendship-stats",
  adminAuth,
  friendshipAdminController.getFriendshipStats,
);

// Shop Items (admin)
router.get("/shop-items", adminAuth, shopAdminController.getShopItems);
router.post("/shop-items", adminAuth, shopAdminController.createShopItem);
router.put("/shop-items/:id", adminAuth, shopAdminController.updateShopItem);
router.delete("/shop-items/:id", adminAuth, shopAdminController.deleteShopItem);

// Player Coins (admin)
router.get("/players/:id/coins", adminAuth, shopAdminController.getPlayerCoins);
router.post(
  "/players/:id/adjust-coins",
  adminAuth,
  shopAdminController.adjustPlayerCoins,
);

// Player Name History (admin)
router.get(
  "/players/:id/name-history",
  adminAuth,
  statsController.getPlayerNameHistory,
);

module.exports = router;
