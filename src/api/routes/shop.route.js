const express = require("express");
const router = express.Router();
const shopController = require("../controllers/shop.controller");

router.get("/items", shopController.getItems);
router.get("/owned/:userId", shopController.getOwned);
router.post("/purchase", shopController.purchase);
router.patch("/equip/:userId", shopController.equip);

module.exports = router;
