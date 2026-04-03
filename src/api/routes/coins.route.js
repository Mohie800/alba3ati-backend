const express = require("express");
const router = express.Router();
const coinsController = require("../controllers/coins.controller");

router.get("/balance/:userId", coinsController.getBalance);
router.get("/history/:userId", coinsController.getHistory);
router.post("/ad-reward", coinsController.claimAdReward);

module.exports = router;
