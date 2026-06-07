const express = require("express");
const router = express.Router();
const shopController = require("../controllers/shop.controller");

router.get("/items", shopController.getItems);
router.get("/owned/:userId", shopController.getOwned);
router.post("/purchase", shopController.purchase);
router.patch("/equip/:userId", shopController.equip);
router.patch("/equip-name-color/:userId", shopController.equipNameColor);
router.patch(
  "/equip-profile-picture/:userId",
  shopController.equipProfilePicture,
);

module.exports = router;
