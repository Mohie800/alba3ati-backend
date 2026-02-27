const express = require("express");
const router = express.Router();
const contactController = require("../controllers/contact.controller");

// Public endpoints
router.post("/", contactController.submitContact);
router.get("/responses/:userId", contactController.getMyResponses);

module.exports = router;
