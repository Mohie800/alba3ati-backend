const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const notificationController = require("../controllers/notification.controller");

// POST /api/auth/register
router.post("/register", authController.register);

// PUT /api/auth/update-name
router.put("/update-name", authController.updateName);

// GET /api/auth/check-ban?deviceId=xxx
router.get("/check-ban", authController.checkBan);

// DELETE /api/auth/delete-account
router.delete("/delete-account", authController.deleteAccount);

// POST /api/auth/google-register
router.post("/google-register", authController.googleRegister);

// POST /api/auth/google-login
router.post("/google-login", authController.googleLogin);

// POST /api/auth/link-google
router.post("/link-google", authController.linkGoogle);

// POST /api/auth/push-token
router.post("/push-token", notificationController.savePushToken);

module.exports = router;
