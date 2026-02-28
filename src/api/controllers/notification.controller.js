const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const { sendPushNotification } = require("../services/pushNotification.service");

exports.savePushToken = async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId || !token) {
      return res.status(400).json({ success: false, message: "userId and token are required" });
    }

    await User.findByIdAndUpdate(userId, { expoPushToken: token });

    res.json({ success: true });
  } catch (err) {
    console.error("Save push token error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.sendNotification = async (req, res) => {
  try {
    const { title, body, userIds } = req.body;

    if (!title || !body) {
      return res.status(400).json({ success: false, message: "Title and body are required" });
    }

    const type = userIds && userIds.length > 0 ? "targeted" : "broadcast";

    const notification = await sendPushNotification({
      title,
      body,
      userIds: userIds || undefined,
      type,
      sentBy: req.admin.id,
    });

    res.json({ success: true, data: { notification } });
  } catch (err) {
    console.error("Send notification error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      Notification.find()
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("sentBy", "username"),
      Notification.countDocuments(),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Get notifications error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    const notifications = await Notification.find({
      recipients: userId,
    })
      .sort({ sentAt: -1 })
      .limit(50)
      .select("title body data type sentAt");

    res.json({ success: true, data: { notifications } });
  } catch (err) {
    console.error("Get user notifications error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
