const mongoose = require("mongoose");
const User = require("../models/user.model");
const Room = require("../models/room.model");
const Contact = require("../models/contact.model");
const BannedDevice = require("../models/bannedDevice.model");
const Report = require("../models/report.model");
const NameChangeLog = require("../models/nameChangeLog.model");
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
    const playersInGames = await require("../game/dailyStats.game")
      .countPlayersInGames()
      .catch(() => 0);

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
        playersInGames,
        activeSocketConnections,
        newContacts,
        pendingReports,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const { paging, containsRegex, dateRange, sortSpec } = require("../../utils/listQuery");

const PLAYER_SORTS = {
  createdAt: "createdAt",
  coins: "coins",
  gamesPlayed: "stats.gamesPlayed",
  gamesWon: "stats.gamesWon",
  name: "name",
};

// ?search=&authProvider=guest|google&referred=yes|no&activity=played|never&from=&to=&sort=-coins
exports.getPlayers = async (req, res) => {
  try {
    const { page, limit, skip } = paging(req.query);
    const search = req.query.search || "";
    const searchBy = req.query.searchBy || "";

    const query = {};
    if (search) {
      const safe = escapeRegex(search.trim());
      const rx = { $regex: safe, $options: "i" };
      if (searchBy === "name" || searchBy === "email" || searchBy === "deviceId") {
        // Explicit single-field search (kept for backward compatibility).
        query[searchBy] = rx;
      } else {
        // Unified search: name, email, device ID, referral code, or exact player id
        const or = [{ name: rx }, { email: rx }, { deviceId: rx }];
        if (/^[A-Za-z0-9]{6}$/.test(search.trim())) {
          or.push({ referralCode: search.trim().toUpperCase() });
        }
        if (mongoose.isValidObjectId(search.trim())) or.push({ _id: search.trim() });
        query.$or = or;
      }
    }
    if (req.query.authProvider === "guest" || req.query.authProvider === "google") {
      query.authProvider = req.query.authProvider;
    }
    if (req.query.referred === "yes") query.referredBy = { $ne: null };
    if (req.query.referred === "no") query.referredBy = null;
    if (req.query.activity === "played") query["stats.gamesPlayed"] = { $gt: 0 };
    if (req.query.activity === "never") query["stats.gamesPlayed"] = { $in: [0, null] };
    const joined = dateRange(req.query.from, req.query.to);
    if (joined) query.createdAt = joined;

    const sort = sortSpec(req.query.sort, PLAYER_SORTS, { createdAt: -1 });

    const [players, total] = await Promise.all([
      User.find(query).sort(sort).skip(skip).limit(limit),
      User.countDocuments(query),
    ]);

    // Flag banned devices on this page so the table can badge them
    const deviceIds = players.map((p) => p.deviceId).filter(Boolean);
    const banned = deviceIds.length
      ? await BannedDevice.find({
          deviceId: { $in: deviceIds.map((d) => d.toLowerCase()) },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        }).select("deviceId")
      : [];
    const bannedSet = new Set(banned.map((b) => b.deviceId));
    const rows = players.map((p) => ({
      ...p.toObject(),
      isBanned: !!p.deviceId && bannedSet.has(p.deviceId.toLowerCase()),
    }));

    res.json({
      success: true,
      data: {
        players: rows,
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

    const [games, deviceBanned, referrer, referred] = await Promise.all([
      Room.find({ "players.player": req.params.id })
        .select("roomId status players roundNumber createdAt")
        .sort({ createdAt: -1 })
        .limit(50),
      player.deviceId
        ? BannedDevice.findOne({ deviceId: player.deviceId })
        : null,
      player.referredBy
        ? User.findById(player.referredBy).select("_id name referralCode")
        : null,
      User.find({ referredBy: player._id })
        .select("_id name createdAt referralStatus")
        .sort({ createdAt: -1 })
        .limit(100),
    ]);

    res.json({
      success: true,
      data: {
        player,
        games,
        deviceBanned: !!deviceBanned,
        referral: { referrer, referred },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const GAME_SORTS = {
  createdAt: "createdAt",
  players: "activePlayers",
  rounds: "roundNumber",
  games: "gamesCompleted",
};

// ?status=&type=public|private|quick&result=0|1|2|3&rematch=yes|no&search=<room code or player name>&from=&to=&sort=
exports.getGames = async (req, res) => {
  try {
    const { page, limit, skip } = paging(req.query);
    const { status, type, result } = req.query;

    const query = {};
    if (["waiting", "playing", "ended"].includes(status)) query.status = status;
    if (type === "quick") query.isQuickPlay = true;
    if (type === "public") Object.assign(query, { isPublic: true, isQuickPlay: { $ne: true } });
    if (type === "private") Object.assign(query, { isPublic: { $ne: true }, isQuickPlay: { $ne: true } });
    if (["0", "1", "2", "3"].includes(result)) query.gameResult = result;
    if (req.query.rematch === "yes") query.gamesCompleted = { $gte: 2 };
    if (req.query.rematch === "no") query.gamesCompleted = { $lt: 2 };
    const created = dateRange(req.query.from, req.query.to);
    if (created) query.createdAt = created;

    const term = (req.query.search || "").trim();
    if (term) {
      const players = await User.find({ name: containsRegex(term) })
        .select("_id")
        .limit(200);
      query.$or = [
        { roomId: term.toLowerCase() },
        { "players.player": { $in: players.map((p) => p._id) } },
      ];
    }

    const sort = sortSpec(req.query.sort, GAME_SORTS, { createdAt: -1 });

    const [games, total] = await Promise.all([
      Room.find(query)
        .select("roomId status activePlayers players createdAt isPublic isQuickPlay gameResult roundNumber host gamesCompleted")
        .sort(sort)
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
    // Treat null, undefined, and empty string as "remove frame"
    const raw = req.body.frame;
    const frame = typeof raw === "string" && raw.trim() ? raw.trim() : null;

    if (frame) {
      const validItem = await ShopItem.findOne({
        itemId: frame,
        type: "frame",
        isActive: true,
      });
      if (!validItem) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid frame ID" });
      }
    }
    // Admin assignment doubles as a gift: grant the frame if the player
    // doesn't already own it, then equip it in one update.
    const update = frame
      ? { $set: { frame }, $addToSet: { ownedFrames: frame } }
      : { $set: { frame: null } };
    const player = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
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

exports.updatePlayerEmail = async (req, res) => {
  try {
    // Treat null, undefined, and empty string as "remove the linked email".
    const raw = req.body.email;
    const email =
      typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null;

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email address" });
    }

    // $unset (not $set: null) so the sparse unique index ignores accounts
    // with no email instead of treating multiple nulls as a collision.
    const update = email ? { $set: { email } } : { $unset: { email: 1 } };

    let player;
    try {
      player = await User.findByIdAndUpdate(req.params.id, update, {
        new: true,
        runValidators: true,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "Email already in use" });
      }
      throw err;
    }

    if (!player) {
      return res
        .status(404)
        .json({ success: false, message: "Player not found" });
    }
    res.json({ success: true, data: { email: player.email ?? null } });
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

    // Must run while the User doc still exists so their room entries match.
    const { removeUserFromActiveRooms } = require("./room.controller");
    await removeUserFromActiveRooms(req.app.get("io"), req.params.id);

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

const TX_TYPES = [
  "game_complete",
  "game_win",
  "ad_reward",
  "shop_purchase",
  "role_purchase",
  "admin_adjust",
  "referral_bonus",
  "weekly_reward",
];

// GET /api/admin/coin-transactions?type=&direction=earn|spend&search=<player>&from=&to=&page=
exports.getCoinTransactions = async (req, res) => {
  try {
    const CoinTransaction = require("../models/coinTransaction.model");
    const { page, limit, skip } = paging(req.query, 25);
    const query = {};
    if (TX_TYPES.includes(req.query.type)) query.type = req.query.type;
    if (req.query.direction === "earn") query.amount = { $gt: 0 };
    if (req.query.direction === "spend") query.amount = { $lt: 0 };
    const created = dateRange(req.query.from, req.query.to);
    if (created) query.createdAt = created;
    const term = (req.query.search || "").trim();
    if (term) {
      const ids = mongoose.isValidObjectId(term)
        ? [term]
        : (await User.find({ name: containsRegex(term) }).select("_id").limit(200)).map(
            (u) => u._id,
          );
      query.user = { $in: ids };
    }

    const [transactions, total] = await Promise.all([
      CoinTransaction.find(query)
        .populate("user", "_id name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CoinTransaction.countDocuments(query),
    ]);
    res.json({
      success: true,
      data: { transactions, total, page, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("getCoinTransactions error:", err);
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

exports.getTopPlayersByCoins = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const players = await User.find()
      .select("_id name profilePicture coins stats.gamesPlayed stats.gamesWon createdAt")
      .sort({ coins: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, data: { players } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getOnlinePlayers = async (req, res) => {
  try {
    const presencePlayers = presenceService.getOnlinePlayers();
    if (presencePlayers.length === 0) {
      return res.json({ success: true, data: { players: [] } });
    }

    const userIds = presencePlayers.map((p) => p.userId);
    const users = await User.find({ _id: { $in: userIds } })
      .select("_id name profilePicture coins stats.gamesPlayed")
      .lean();

    const userMap = {};
    for (const u of users) {
      userMap[u._id.toString()] = u;
    }

    const players = presencePlayers
      .map((p) => {
        const user = userMap[p.userId];
        if (!user) return null;
        return {
          _id: user._id,
          name: user.name,
          profilePicture: user.profilePicture,
          coins: user.coins,
          gamesPlayed: user.stats?.gamesPlayed ?? 0,
          status: p.status,
          roomId: p.roomId || null,
          roomStatus: p.roomStatus || null,
        };
      })
      .filter(Boolean);

    res.json({ success: true, data: { players } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getPlayerNameHistory = async (req, res) => {
  try {
    const logs = await NameChangeLog.find({ user: req.params.id })
      .sort({ changedAt: -1 })
      .limit(50)
      .lean();
    res.json({ success: true, data: { logs } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
