const express = require("express");
const router = express.Router();
const reportController = require("../controllers/report.controller");

// Public endpoints
router.post("/", reportController.submitReport);

module.exports = router;
