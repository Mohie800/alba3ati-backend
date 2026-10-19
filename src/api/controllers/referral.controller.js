const mongoose = require("mongoose");
const User = require("../models/user.model");
const AppSettings = require("../models/appSettings.model");
const {
  ensureReferralCode,
  linkReferral,
  APPLY_WINDOW_MS,
} = require("../services/referral.service");

// GET /api/referrals/me/:userId — own code, rewards, and how many friends joined
exports.getMine = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      "_id referralCode referredBy referralStatus referralEligible createdAt stats.gamesPlayed",
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const [code, settings, rewarded, pending] = await Promise.all([
      ensureReferralCode(user),
      AppSettings.getSettings(),
      User.countDocuments({ referredBy: user._id, referralStatus: "rewarded" }),
      User.countDocuments({ referredBy: user._id, referralStatus: "pending" }),
    ]);
    const cfg = settings.referral || {};
    // Mirrors linkReferral's checks so the app only offers the field when it can work
    const canEnterCode =
      cfg.enabled !== false &&
      user.referralEligible &&
      !user.referredBy &&
      !user.referralStatus &&
      (user.stats?.gamesPlayed || 0) === 0 &&
      Date.now() - new Date(user.createdAt).getTime() < APPLY_WINDOW_MS;
    res.json({
      success: true,
      data: {
        code,
        enabled: cfg.enabled !== false,
        referrerReward: cfg.referrerReward ?? 100,
        refereeReward: cfg.refereeReward ?? 100,
        rewarded,
        pending,
        canEnterCode,
        referralStatus: user.referralStatus,
        playStoreUrl: settings.playStoreUrl || "",
        appStoreUrl: settings.appStoreUrl || "",
      },
    });
  } catch (err) {
    console.error("getMine referral error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /api/referrals/apply — the Google signup flow enters a code after account creation
exports.apply = async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, reason: "BAD_REQUEST" });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, reason: "BAD_REQUEST" });
    }
    const result = await linkReferral(user, code);
    res.json({ success: result.ok, reason: result.reason || null });
  } catch (err) {
    console.error("apply referral error:", err);
    res.status(500).json({ success: false, reason: "ERROR" });
  }
};

// GET /api/admin/referrals?status=&search=&page=&limit=
exports.adminList = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const { status, search } = req.query;

    const filter = { referredBy: { $ne: null } };
    if (status === "pending" || status === "rewarded") {
      filter.referralStatus = status;
    }
    if (search && search.trim()) {
      const term = search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match either side: the new player by name/id, or the referrer by name/code
      const referrers = await User.find({
        $or: [
          { name: { $regex: escaped, $options: "i" } },
          { referralCode: term.toUpperCase() },
        ],
      })
        .select("_id")
        .limit(200);
      const or = [
        { name: { $regex: escaped, $options: "i" } },
        { referredBy: { $in: referrers.map((r) => r._id) } },
      ];
      if (mongoose.isValidObjectId(term)) or.push({ _id: term });
      filter.$or = or;
    }

    const [rows, total, totals] = await Promise.all([
      User.find(filter)
        .select("_id name createdAt referralStatus referralRewardedAt referredBy stats.gamesPlayed")
        .populate("referredBy", "_id name referralCode")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
      User.aggregate([
        { $match: { referredBy: { $ne: null } } },
        { $group: { _id: "$referralStatus", count: { $sum: 1 } } },
      ]),
    ]);

    const summary = { pending: 0, rewarded: 0 };
    for (const t of totals) if (t._id in summary) summary[t._id] = t.count;

    res.json({
      success: true,
      data: {
        referrals: rows,
        summary,
        page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    console.error("admin referrals error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
