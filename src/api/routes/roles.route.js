const express = require("express");
const router = express.Router();
const rolesController = require("../controllers/roles.controller");

router.get("/", rolesController.getRoles);
router.get("/owned/:userId", rolesController.getOwnedRoles);
router.post("/purchase", rolesController.purchaseRole);

module.exports = router;
