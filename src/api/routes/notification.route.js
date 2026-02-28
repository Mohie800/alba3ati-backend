const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification.controller");

// GET /api/notifications/:userId
router.get("/:userId", notificationController.getUserNotifications);

module.exports = router;
