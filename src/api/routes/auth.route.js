const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");

// POST /api/auth/register
router.post("/register", authController.register);

// GET /api/auth/check-ban?deviceId=xxx
router.get("/check-ban", authController.checkBan);

module.exports = router;
