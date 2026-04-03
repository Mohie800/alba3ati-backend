const User = require("../models/user.model");
const BannedDevice = require("../models/bannedDevice.model");
const config = require("../../config/config");
const { recordNewUser } = require("../game/dailyStats.game");
const { verifyGoogleToken } = require("../../utils/google");

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
      const banned = await BannedDevice.findOne({
        deviceId: normalizedDeviceId,
      });
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
    const user = await User.create({
      name,
      deviceId: deviceId || null,
      authProvider: "guest",
    });
    recordNewUser();

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
      return res
        .status(400)
        .json({ success: false, error: "userId is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Verify device ID matches (skip for Google users)
    if (user.authProvider !== "google") {
      const normalizedDeviceId = normalizeDeviceId(deviceId);
      if (
        normalizedDeviceId &&
        user.deviceId &&
        normalizeDeviceId(user.deviceId) !== normalizedDeviceId
      ) {
        return res
          .status(403)
          .json({ success: false, error: "Device mismatch" });
      }
    }

    // Delete all user-related data
    const Contact = require("../models/contact.model");
    const Report = require("../models/report.model");
    const Notification = require("../models/notification.model");
    const Friendship = require("../models/friendship.model");

    // Find accepted friendships to decrement friendCount on the other party
    const acceptedFriendships = await Friendship.find({
      status: "accepted",
      $or: [{ requester: userId }, { recipient: userId }],
    }).lean();

    const friendUserIds = acceptedFriendships.map((f) => {
      return f.requester.toString() === userId
        ? f.recipient.toString()
        : f.requester.toString();
    });

    await Promise.all([
      // Delete user's contacts/messages
      Contact.deleteMany({ player: userId }),
      // Delete reports filed by this user
      Report.deleteMany({ reporter: userId }),
      // Remove user from notification recipients
      Notification.updateMany(
        { recipients: userId },
        { $pull: { recipients: userId } },
      ),
      // Delete all friendship records involving this user
      Friendship.deleteMany({
        $or: [{ requester: userId }, { recipient: userId }],
      }),
      // Decrement friendCount on all friends
      ...(friendUserIds.length > 0
        ? [
            User.updateMany(
              { _id: { $in: friendUserIds } },
              { $inc: { friendCount: -1 } },
            ),
          ]
        : []),
      // Delete the user
      User.findByIdAndDelete(userId),
    ]);

    res.json({
      success: true,
      message: "Account and all associated data deleted",
    });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ success: false, error: "Failed to delete account" });
  }
};

exports.updateName = async (req, res) => {
  try {
    const { userId, name } = req.body;

    if (!userId || !name || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: "userId and a name with at least 2 characters are required",
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { name: name.trim() },
      { new: true },
    );

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    res.json({
      success: true,
      data: { user: { id: user._id, name: user.name } },
    });
  } catch (error) {
    console.error("Update name error:", error);
    res.status(500).json({ success: false, error: "Failed to update name" });
  }
};

exports.checkBan = async (req, res) => {
  try {
    const { deviceId } = req.query;

    if (!deviceId) {
      return res
        .status(400)
        .json({ success: false, error: "deviceId is required" });
    }

    const banned = await BannedDevice.findOne({
      deviceId: normalizeDeviceId(deviceId),
    });

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

exports.googleRegister = async (req, res) => {
  try {
    const { idToken, deviceId } = req.body;

    if (!idToken) {
      return res
        .status(400)
        .json({ success: false, error: "idToken is required" });
    }

    const payload = await verifyGoogleToken(idToken);

    // Check if Google account is already linked
    const existingUser = await User.findOne({
      $or: [{ googleId: payload.googleId }, { email: payload.email }],
    });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_LINKED",
        error: "هذا الحساب مرتبط بالفعل، قم بتسجيل الدخول",
      });
    }

    // Check device ban
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (normalizedDeviceId) {
      const banned = await BannedDevice.findOne({
        deviceId: normalizedDeviceId,
      });
      if (banned) {
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

    const user = await User.create({
      name: payload.name,
      email: payload.email,
      googleId: payload.googleId,
      profilePicture: payload.picture,
      authProvider: "google",
      deviceId: normalizedDeviceId,
    });
    recordNewUser();

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          authProvider: user.authProvider,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    console.error("Google register error:", error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_LINKED",
        error: "هذا الحساب مرتبط بالفعل، قم بتسجيل الدخول",
      });
    }
    res.status(500).json({ success: false, error: "حدث خطأ، حاول مرة أخرى" });
  }
};

exports.googleLogin = async (req, res) => {
  try {
    const { idToken, deviceId } = req.body;

    if (!idToken) {
      return res
        .status(400)
        .json({ success: false, error: "idToken is required" });
    }

    const payload = await verifyGoogleToken(idToken);

    const user = await User.findOne({ googleId: payload.googleId });
    if (!user) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        error: "لم يتم العثور على حساب، قم بالتسجيل أولاً",
      });
    }

    // Update deviceId
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (normalizedDeviceId) {
      user.deviceId = normalizedDeviceId;
      await user.save();
    }

    // Check device ban
    if (normalizedDeviceId) {
      const banned = await BannedDevice.findOne({
        deviceId: normalizedDeviceId,
      });
      if (banned) {
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

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          authProvider: user.authProvider,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    console.error("Google login error:", error);
    res.status(500).json({ success: false, error: "حدث خطأ، حاول مرة أخرى" });
  }
};

exports.linkGoogle = async (req, res) => {
  try {
    const { userId, idToken } = req.body;

    if (!userId || !idToken) {
      return res
        .status(400)
        .json({ success: false, error: "userId and idToken are required" });
    }

    const payload = await verifyGoogleToken(idToken);

    // Check if Google account is already linked to another user
    const existingUser = await User.findOne({
      $or: [{ googleId: payload.googleId }, { email: payload.email }],
      _id: { $ne: userId },
    });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_LINKED",
        error: "هذا الحساب مرتبط بحساب آخر",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    if (user.authProvider === "google") {
      return res.status(400).json({
        success: false,
        code: "ALREADY_LINKED",
        error: "حسابك مرتبط بالفعل بحساب Google",
      });
    }

    // Link Google account in-place (preserves _id, stats, everything)
    user.googleId = payload.googleId;
    user.email = payload.email;
    user.profilePicture = payload.picture;
    user.authProvider = "google";
    await user.save();

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          authProvider: user.authProvider,
        },
      },
    });
  } catch (error) {
    console.error("Link Google error:", error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_LINKED",
        error: "هذا الحساب مرتبط بحساب آخر",
      });
    }
    res.status(500).json({ success: false, error: "حدث خطأ، حاول مرة أخرى" });
  }
};
