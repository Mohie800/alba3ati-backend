const User = require("../models/user.model");
const Room = require("../models/room.model");
const Contact = require("../models/contact.model");
const BannedDevice = require("../models/bannedDevice.model");
const Report = require("../models/report.model");

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

    res.json({
      success: true,
      data: {
        totalPlayers,
        playersToday,
        totalGames,
        activeGames,
        activeRooms,
        activeConnections,
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
    const skip = (page - 1) * limit;

    const query = search ? { name: { $regex: search, $options: "i" } } : {};

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
      return res.status(404).json({ success: false, message: "Player not found" });
    }

    const [games, deviceBanned] = await Promise.all([
      Room.find({ "players.player": req.params.id })
        .select("roomId status players roundNumber createdAt")
        .sort({ createdAt: -1 })
        .limit(50),
      player.deviceId ? BannedDevice.findOne({ deviceId: player.deviceId }) : null,
    ]);

    res.json({ success: true, data: { player, games, deviceBanned: !!deviceBanned } });
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
    const game = await Room.findById(req.params.id).populate("players.player", "name createdAt");
    if (!game) {
      return res.status(404).json({ success: false, message: "Game not found" });
    }
    res.json({ success: true, data: { game } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
