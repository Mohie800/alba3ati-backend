const User = require("../models/user.model");
const BannedDevice = require("../models/bannedDevice.model");
const config = require("../../config/config");

const normalizeDeviceId = (id) => (id ? id.trim().toLowerCase() : null);

exports.register = async (req, res) => {
  try {
    const { name, deviceId } = req.body;

    // Validate input
    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    // Check if device is banned
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (normalizedDeviceId) {
      const banned = await BannedDevice.findOne({ deviceId: normalizedDeviceId });
      if (banned) {
        // Check if ban has expired
        if (banned.expiresAt && banned.expiresAt < new Date()) {
          await BannedDevice.deleteOne({ _id: banned._id });
        } else {
          return res.status(403).json({
            success: false,
            code: "DEVICE_BANNED",
            error: "This device has been banned",
            reason: banned.reason,
          });
        }
      }
    }

    // Create a new user
    const user = await User.create({ name, deviceId: deviceId || null });

    // Respond with user data and token
    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    console.error("Registration error:", error);

    // Handle duplicate key errors (e.g., if email is added later and made unique)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "User already exists",
      });
    }

    res.status(500).json({
      success: false,
      error: "Registration failed. Please try again.",
    });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    const { userId, deviceId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: "userId is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Verify device ID matches (prevent deleting someone else's account)
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (normalizedDeviceId && user.deviceId && normalizeDeviceId(user.deviceId) !== normalizedDeviceId) {
      return res.status(403).json({ success: false, error: "Device mismatch" });
    }

    // Delete all user-related data
    const Contact = require("../models/contact.model");
    const Report = require("../models/report.model");
    const Notification = require("../models/notification.model");

    await Promise.all([
      // Delete user's contacts/messages
      Contact.deleteMany({ player: userId }),
      // Delete reports filed by this user
      Report.deleteMany({ reporter: userId }),
      // Remove user from notification recipients
      Notification.updateMany(
        { recipients: userId },
        { $pull: { recipients: userId } }
      ),
      // Delete the user
      User.findByIdAndDelete(userId),
    ]);

    res.json({ success: true, message: "Account and all associated data deleted" });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ success: false, error: "Failed to delete account" });
  }
};

exports.checkBan = async (req, res) => {
  try {
    const { deviceId } = req.query;

    if (!deviceId) {
      return res.status(400).json({ success: false, error: "deviceId is required" });
    }

    const banned = await BannedDevice.findOne({ deviceId: normalizeDeviceId(deviceId) });

    if (banned && banned.expiresAt && banned.expiresAt < new Date()) {
      await BannedDevice.deleteOne({ _id: banned._id });
      return res.json({ success: true, data: { banned: false, reason: null } });
    }

    res.json({
      success: true,
      data: {
        banned: !!banned,
        reason: banned ? banned.reason : null,
      },
    });
  } catch (error) {
    console.error("Check ban error:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
};
