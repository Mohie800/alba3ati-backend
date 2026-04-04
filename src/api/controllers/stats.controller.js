const User = require("../models/user.model");
const Room = require("../models/room.model");
const Contact = require("../models/contact.model");
const BannedDevice = require("../models/bannedDevice.model");
const Report = require("../models/report.model");
const presenceService = require("../services/presence.service");

exports.getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalPlayers,
      playersToday,
      totalGames,
      activeGames,
      activeRooms,
      activeConnectionsResult,
      newContacts,
      pendingReports,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: today } }),
      Room.countDocuments({ status: { $ne: "waiting" } }),
      Room.countDocuments({ status: "playing" }),
      Room.countDocuments({ status: "waiting" }),
      Room.aggregate([
        { $match: { status: { $in: ["playing", "waiting"] } } },
        { $group: { _id: null, total: { $sum: "$activePlayers" } } },
      ]),
      Contact.countDocuments({ status: "new" }),
      Report.countDocuments({ status: "pending" }),
    ]);

    const activeConnections =
      activeConnectionsResult.length > 0 ? activeConnectionsResult[0].total : 0;

    const io = req.app.get("io");
    const onlinePlayers = presenceService.getOnlineCount();
    const activeSocketConnections = io ? io.engine.clientsCount : 0;

    res.json({
      success: true,
      data: {
        totalPlayers,
        playersToday,
        totalGames,
        activeGames,
        activeRooms,
        activeConnections,
        onlinePlayers,
        activeSocketConnections,
        newContacts,
        pendingReports,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getPlayers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || "";
    const searchBy = req.query.searchBy || "name";
    const skip = (page - 1) * limit;

    let query = {};
    if (search) {
      if (searchBy === "deviceId") {
        query = { deviceId: { $regex: search, $options: "i" } };
      } else {
        query = { name: { $regex: search, $options: "i" } };
      }
    }

    const [players, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        players,
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getPlayerDetail = async (req, res) => {
  try {
    const player = await User.findById(req.params.id);
    if (!player) {
      return res
        .status(404)
        .json({ success: false, message: "Player not found" });
    }

    const [games, deviceBanned] = await Promise.all([
      Room.find({ "players.player": req.params.id })
        .select("roomId status players roundNumber createdAt")
        .sort({ createdAt: -1 })
        .limit(50),
      player.deviceId
        ? BannedDevice.findOne({ deviceId: player.deviceId })
        : null,
    ]);

    res.json({
      success: true,
      data: { player, games, deviceBanned: !!deviceBanned },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getGames = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const skip = (page - 1) * limit;

    const query = status ? { status } : {};

    const [games, total] = await Promise.all([
      Room.find(query)
        .select("roomId status activePlayers players createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Room.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        games,
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getGameDetail = async (req, res) => {
  try {
    const game = await Room.findById(req.params.id).populate(
      "players.player",
      "name createdAt",
    );
    if (!game) {
      return res
        .status(404)
        .json({ success: false, message: "Game not found" });
    }
    res.json({ success: true, data: { game } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const Friendship = require("../models/friendship.model");
const CoinTransaction = require("../models/coinTransaction.model");
const ShopItem = require("../models/shopItem.model");

exports.updatePlayerFrame = async (req, res) => {
  try {
    const { frame } = req.body;
    if (frame !== null && frame !== undefined) {
      const validItem = await ShopItem.findOne({
        itemId: frame,
        isActive: true,
      });
      if (!validItem) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid frame ID" });
      }
    }
    // Check ownership if setting a frame (null = removing frame, always allowed)
    if (frame) {
      const user = await User.findById(req.params.id).select("ownedFrames");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "Player not found" });
      }
      if (!user.ownedFrames.includes(frame)) {
        return res
          .status(403)
          .json({ success: false, message: "Frame not owned" });
      }
    }
    const player = await User.findByIdAndUpdate(
      req.params.id,
      { frame: frame || null },
      { new: true },
    );
    if (!player) {
      return res
        .status(404)
        .json({ success: false, message: "Player not found" });
    }
    res.json({ success: true, data: { frame: player.frame } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deletePlayer = async (req, res) => {
  try {
    const player = await User.findById(req.params.id);
    if (!player) {
      return res
        .status(404)
        .json({ success: false, message: "Player not found" });
    }

    await Promise.all([
      User.findByIdAndDelete(req.params.id),
      Friendship.deleteMany({
        $or: [{ requester: req.params.id }, { recipient: req.params.id }],
      }),
      CoinTransaction.deleteMany({ user: req.params.id }),
    ]);

    res.json({ success: true, message: "Player deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getCoinStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalCoins, breakdownByType, todayBreakdown, recentTransactions] =
      await Promise.all([
        User.aggregate([
          { $group: { _id: null, total: { $sum: "$coins" } } },
        ]),
        CoinTransaction.aggregate([
          {
            $group: {
              _id: "$type",
              totalAmount: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),
        CoinTransaction.aggregate([
          { $match: { createdAt: { $gte: today } } },
          {
            $group: {
              _id: "$type",
              totalAmount: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ]),
        CoinTransaction.find()
          .sort({ createdAt: -1 })
          .limit(20)
          .populate("user", "name"),
      ]);

    const totalCoinsInCirculation =
      totalCoins.length > 0 ? totalCoins[0].total : 0;

    const totalEarned = breakdownByType
      .filter((b) => b.totalAmount > 0)
      .reduce((sum, b) => sum + b.totalAmount, 0);
    const totalSpent = breakdownByType
      .filter((b) => b.totalAmount < 0)
      .reduce((sum, b) => sum + Math.abs(b.totalAmount), 0);

    res.json({
      success: true,
      data: {
        totalCoinsInCirculation,
        totalEarned,
        totalSpent,
        breakdownByType,
        todayBreakdown,
        recentTransactions,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
