const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

const {
  sendRequest,
  acceptRequest,
  declineRequest,
  cancelRequest,
  removeFriend,
  blockPlayer,
  unblockPlayer,
  getFriends,
  getIncomingRequests,
  getOutgoingRequests,
  getBatchStatus,
  searchPlayers,
} = require("../services/friendship.service");

// Rate limit: max 20 friend requests per hour per user
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  keyGenerator: (req) => req.body?.userId || req.ip,
  message: { error: "تجاوزت الحد المسموح به من طلبات الصداقة. حاول لاحقاً." },
  standardHeaders: true,
  legacyHeaders: false,
});

function handleError(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "حدث خطأ" });
}

const isValidId = (id) => mongoose.isValidObjectId(id);

// POST /api/friends/request
router.post("/request", requestLimiter, async (req, res) => {
  try {
    const { userId, targetUserId } = req.body;
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: "userId و targetUserId مطلوبان" });
    }
    if (!isValidId(userId) || !isValidId(targetUserId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const result = await sendRequest(userId, targetUserId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/friends/accept
router.post("/accept", async (req, res) => {
  try {
    const { userId, requesterId } = req.body;
    if (!userId || !requesterId) {
      return res.status(400).json({ error: "userId و requesterId مطلوبان" });
    }
    if (!isValidId(userId) || !isValidId(requesterId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const result = await acceptRequest(userId, requesterId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/friends/decline
router.post("/decline", async (req, res) => {
  try {
    const { userId, requesterId } = req.body;
    if (!userId || !requesterId) {
      return res.status(400).json({ error: "userId و requesterId مطلوبان" });
    }
    if (!isValidId(userId) || !isValidId(requesterId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const result = await declineRequest(userId, requesterId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/friends/cancel
router.post("/cancel", async (req, res) => {
  try {
    const { userId, targetUserId } = req.body;
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: "userId و targetUserId مطلوبان" });
    }
    if (!isValidId(userId) || !isValidId(targetUserId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const result = await cancelRequest(userId, targetUserId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/friends/remove
router.post("/remove", async (req, res) => {
  try {
    const { userId, friendId } = req.body;
    if (!userId || !friendId) {
      return res.status(400).json({ error: "userId و friendId مطلوبان" });
    }
    if (!isValidId(userId) || !isValidId(friendId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const result = await removeFriend(userId, friendId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/friends/block
router.post("/block", async (req, res) => {
  try {
    const { userId, targetUserId } = req.body;
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: "userId و targetUserId مطلوبان" });
    }
    if (!isValidId(userId) || !isValidId(targetUserId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const result = await blockPlayer(userId, targetUserId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/friends/unblock
router.post("/unblock", async (req, res) => {
  try {
    const { userId, targetUserId } = req.body;
    if (!userId || !targetUserId) {
      return res.status(400).json({ error: "userId و targetUserId مطلوبان" });
    }
    if (!isValidId(userId) || !isValidId(targetUserId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const result = await unblockPlayer(userId, targetUserId);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/friends/list/:userId?page=1&limit=20
router.get("/list/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const result = await getFriends(userId, page, limit);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/friends/requests/:userId?page=1&limit=20
router.get("/requests/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const requests = await getIncomingRequests(userId, page, limit);
    res.json({ requests });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/friends/sent/:userId?page=1&limit=20
router.get("/sent/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const requests = await getOutgoingRequests(userId, page, limit);
    res.json({ requests });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/friends/batch-status
router.post("/batch-status", async (req, res) => {
  try {
    const { userId, targetUserIds } = req.body;
    if (!userId || !Array.isArray(targetUserIds)) {
      return res
        .status(400)
        .json({ error: "userId و targetUserIds[] مطلوبان" });
    }
    if (!isValidId(userId) || targetUserIds.some((id) => !isValidId(id))) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const statuses = await getBatchStatus(userId, targetUserIds);
    res.json({ statuses });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/friends/search/:userId?q=term&page=1&limit=15
router.get("/search/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidId(userId)) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const { q, page, limit } = req.query;
    const results = await searchPlayers(
      userId,
      q,
      parseInt(page) || 1,
      Math.min(parseInt(limit) || 15, 30),
    );
    res.json({ results });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
