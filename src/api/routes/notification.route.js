const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification.controller");

router.get(
  "/preferences/:userId/public-rooms",
  notificationController.getPublicRoomPreference,
);
router.put(
  "/preferences/:userId/public-rooms",
  notificationController.updatePublicRoomPreference,
);

// GET /api/notifications/:userId
router.get("/:userId", notificationController.getUserNotifications);

module.exports = router;
