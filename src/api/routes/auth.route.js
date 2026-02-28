const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const notificationController = require("../controllers/notification.controller");

// POST /api/auth/register
router.post("/register", authController.register);

// GET /api/auth/check-ban?deviceId=xxx
router.get("/check-ban", authController.checkBan);

// POST /api/auth/push-token
router.post("/push-token", notificationController.savePushToken);

module.exports = router;
