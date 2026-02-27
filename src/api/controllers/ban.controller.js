const BannedDevice = require("../models/bannedDevice.model");

exports.banDevice = async (req, res) => {
  try {
    const { deviceId, reason } = req.body;

    if (!deviceId) {
      return res.status(400).json({ success: false, message: "deviceId is required" });
    }

    const existing = await BannedDevice.findOne({ deviceId });
    if (existing) {
      return res.status(409).json({ success: false, message: "Device is already banned" });
    }

    const ban = await BannedDevice.create({
      deviceId,
      reason: reason || "",
      bannedBy: req.admin.id,
    });

    res.status(201).json({ success: true, data: { ban } });
  } catch (err) {
    console.error("Ban device error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.listBans = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [bans, total] = await Promise.all([
      BannedDevice.find()
        .populate("bannedBy", "username")
        .sort({ bannedAt: -1 })
        .skip(skip)
        .limit(limit),
      BannedDevice.countDocuments(),
    ]);

    res.json({
      success: true,
      data: {
        bans,
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("List bans error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.checkDevice = async (req, res) => {
  try {
    const ban = await BannedDevice.findOne({ deviceId: req.params.deviceId }).populate(
      "bannedBy",
      "username"
    );

    if (!ban) {
      return res.json({ success: true, data: { banned: false } });
    }

    res.json({ success: true, data: { banned: true, ban } });
  } catch (err) {
    console.error("Check device error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.unbanDevice = async (req, res) => {
  try {
    const result = await BannedDevice.findOneAndDelete({ deviceId: req.params.deviceId });

    if (!result) {
      return res.status(404).json({ success: false, message: "Ban not found" });
    }

    res.json({ success: true, message: "Device unbanned" });
  } catch (err) {
    console.error("Unban device error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
