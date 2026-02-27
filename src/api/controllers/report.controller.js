const Report = require("../models/report.model");
const User = require("../models/user.model");
const BannedDevice = require("../models/bannedDevice.model");

exports.submitReport = async (req, res) => {
  try {
    const { reporter, reporterName, reportedPlayer, reportedPlayerName, room, roomId, reason, details } = req.body;

    if (!reporter || !reportedPlayer || !room || !reason) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    if (reporter === reportedPlayer) {
      return res.status(400).json({ success: false, message: "Cannot report yourself" });
    }

    const report = await Report.create({
      reporter,
      reporterName: reporterName || "",
      reportedPlayer,
      reportedPlayerName: reportedPlayerName || "",
      room,
      roomId: roomId || "",
      reason,
      details: details || "",
    });

    res.status(201).json({ success: true, data: { report } });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: "Already reported this player in this game" });
    }
    console.error("Submit report error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getReports = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const reason = req.query.reason;
    const skip = (page - 1) * limit;

    const query = {};
    if (status) query.status = status;
    if (reason) query.reason = reason;

    const [reports, total] = await Promise.all([
      Report.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Report.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        reports,
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Get reports error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getReportDetail = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate("reporter", "name")
      .populate("reportedPlayer", "name deviceId")
      .populate("room", "roomId status players createdAt")
      .populate("resolvedBy", "username");

    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    res.json({ success: true, data: { report } });
  } catch (err) {
    console.error("Get report detail error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.resolveReport = async (req, res) => {
  try {
    const { action, adminNote } = req.body;

    if (!action || !["dismissed", "warned", "banned"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid action" });
    }

    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    if (report.status !== "pending") {
      return res.status(400).json({ success: false, message: "Report already resolved" });
    }

    // If banning, look up the reported player's deviceId and create a ban
    if (action === "banned") {
      const reportedUser = await User.findById(report.reportedPlayer);
      if (reportedUser && reportedUser.deviceId) {
        const existing = await BannedDevice.findOne({ deviceId: reportedUser.deviceId });
        if (!existing) {
          await BannedDevice.create({
            deviceId: reportedUser.deviceId,
            reason: adminNote || `Banned via report: ${report.reason}`,
            bannedBy: req.admin.id,
          });
        }
      }
    }

    report.status = action;
    report.adminNote = adminNote || null;
    report.resolvedBy = req.admin.id;
    report.resolvedAt = new Date();
    await report.save();

    res.json({ success: true, data: { report } });
  } catch (err) {
    console.error("Resolve report error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
