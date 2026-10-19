const express = require("express");
const router = express.Router();
const referralController = require("../controllers/referral.controller");

router.get("/me/:userId", referralController.getMine);
router.post("/apply", referralController.apply);

module.exports = router;
