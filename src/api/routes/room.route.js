const express = require("express");
const router = express.Router();
const roomController = require("../controllers/room.controller");

// POST /api/auth/register
router.get("/", async (req, res) => {
  try {
    const rooms = await roomController.getActiveRooms();
    return res.json(rooms);
  } catch (error) {
    return res.status(404).json({ error });
  }
});

module.exports = router;
