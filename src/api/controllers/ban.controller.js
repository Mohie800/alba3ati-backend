const BannedDevice = require("../models/bannedDevice.model");

const normalizeDeviceId = (id) => id.trim().toLowerCase();

const isValidDeviceId = (id) => {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  return trimmed.length >= 8 && trimmed.length <= 255;
};

exports.banDevice = async (req, res) => {
  try {
    const { deviceId, reason, expiresAt } = req.body;

    if (!deviceId) {
      return res.status(400).json({ success: false, message: "deviceId is required" });
    }

    if (!isValidDeviceId(deviceId)) {
      return res.status(400).json({ success: false, message: "Invalid deviceId format (must be 8-255 characters)" });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: "reason is required" });
    }

    if (expiresAt && isNaN(Date.parse(expiresAt))) {
      return res.status(400).json({ success: false, message: "Invalid expiresAt date" });
    }

    const normalized = normalizeDeviceId(deviceId);

    // Use findOneAndUpdate with upsert to avoid race condition between findOne and create
    const existing = await BannedDevice.findOne({ deviceId: normalized });
    if (existing) {
      return res.status(409).json({ success: false, message: "Device is already banned" });
    }

    try {
      const ban = await BannedDevice.create({
        deviceId: normalized,
        reason: reason.trim(),
        bannedBy: req.admin.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });

      res.status(201).json({ success: true, data: { ban } });
    } catch (err) {
      // Handle race condition: if another request created the ban between our check and create
      if (err.code === 11000) {
        return res.status(409).json({ success: false, message: "Device is already banned" });
      }
      throw err;
    }
  } catch (err) {
    console.error("Ban device error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.listBans = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
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
    const rawId = req.params.deviceId;
    if (!rawId || !isValidDeviceId(rawId)) {
      return res.status(400).json({ success: false, message: "Invalid deviceId" });
    }

    const ban = await BannedDevice.findOne({ deviceId: normalizeDeviceId(rawId) }).populate(
      "bannedBy",
      "username"
    );

    if (!ban) {
      return res.json({ success: true, data: { banned: false } });
    }

    // Check if ban has expired
    if (ban.expiresAt && ban.expiresAt < new Date()) {
      await BannedDevice.deleteOne({ _id: ban._id });
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
    const rawId = req.params.deviceId;
    if (!rawId || !isValidDeviceId(rawId)) {
      return res.status(400).json({ success: false, message: "Invalid deviceId" });
    }

    const result = await BannedDevice.findOneAndDelete({ deviceId: normalizeDeviceId(rawId) });

    if (!result) {
      return res.status(404).json({ success: false, message: "Ban not found for this device" });
    }

    res.json({ success: true, message: "Device unbanned" });
  } catch (err) {
    console.error("Unban device error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
