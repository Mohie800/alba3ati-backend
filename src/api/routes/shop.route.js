const express = require("express");
const router = express.Router();
const shopController = require("../controllers/shop.controller");

router.get("/items", shopController.getItems);
router.get("/owned/:userId", shopController.getOwned);
router.post("/purchase", shopController.purchase);
router.patch("/equip/:userId", shopController.equip);
router.patch("/equip-name-color/:userId", shopController.equipNameColor);

module.exports = router;
