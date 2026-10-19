const Report = require("../models/report.model");
const { containsRegex, dateRange } = require("../../utils/listQuery");
const User = require("../models/user.model");
const BannedDevice = require("../models/bannedDevice.model");
const Notification = require("../models/notification.model");
const { sendPushNotification } = require("../services/pushNotification.service");

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
    const term = (req.query.search || "").trim();
    if (term) {
      const rx = containsRegex(term);
      query.$or = [
        { reporterName: rx },
        { reportedPlayerName: rx },
        { roomId: term.toLowerCase() },
        { details: rx },
      ];
    }
    const created = dateRange(req.query.from, req.query.to);
    if (created) query.createdAt = created;

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
    const { action, adminNote, expiresAt } = req.body;

    if (!action || !["dismissed", "warned", "banned"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid action" });
    }

    // Validate expiresAt only when present (used by temporary blocks)
    if (expiresAt && isNaN(Date.parse(expiresAt))) {
      return res.status(400).json({ success: false, message: "Invalid expiresAt date" });
    }
    if (expiresAt && new Date(expiresAt) <= new Date()) {
      return res.status(400).json({ success: false, message: "expiresAt must be in the future" });
    }

    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    if (report.status !== "pending") {
      return res.status(400).json({ success: false, message: "Report already resolved" });
    }

    // WARN: notify the reported player (push + in-app record)
    if (action === "warned") {
      const title = "تحذير من الإدارة";
      const body =
        adminNote && adminNote.trim()
          ? adminNote.trim()
          : "تلقيت تحذيراً من إدارة اللعبة بسبب مخالفة. يرجى الالتزام بقواعد اللعب.";
      const data = { type: "warning", reportId: report._id.toString() };

      // Fire-and-forget — must not block or fail the resolve response.
      sendPushNotification({
        title,
        body,
        data,
        userIds: [report.reportedPlayer.toString()],
        type: "targeted",
        sentBy: req.admin.id,
      })
        .then(async (notification) => {
          // sendPushNotification returns null (and creates NO record) when the
          // player has no valid Expo token. Create the record anyway so the warn
          // is always visible in the app's notifications screen.
          if (!notification) {
            await Notification.create({
              title,
              body,
              data,
              type: "targeted",
              recipients: [report.reportedPlayer],
              recipientCount: 1,
              sentBy: req.admin.id,
            });
          }
        })
        .catch((err) => console.error("Warn notification error:", err));
    }

    // BAN / TEMP-BLOCK: create or refresh a device ban (optionally time-limited)
    if (action === "banned") {
      const reportedUser = await User.findById(report.reportedPlayer);
      if (reportedUser && reportedUser.deviceId) {
        // Normalize to match ban enforcement (socket.io + auth use trim().toLowerCase())
        const normalizedId = reportedUser.deviceId.trim().toLowerCase();
        await BannedDevice.findOneAndUpdate(
          { deviceId: normalizedId },
          {
            $set: {
              deviceId: normalizedId,
              reason: adminNote || `Banned via report: ${report.reason}`,
              bannedBy: req.admin.id,
              expiresAt: expiresAt ? new Date(expiresAt) : null,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
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
