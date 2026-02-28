const User = require("../models/user.model");
const Notification = require("../models/notification.model");

let Expo, expo;
async function getExpo() {
  if (!expo) {
    ({ Expo } = await import("expo-server-sdk"));
    expo = new Expo();
  }
  return { Expo, expo };
}

/**
 * Send push notifications to users and create a notification record.
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.body
 * @param {Object} [params.data]
 * @param {string[]} [params.userIds] - If omitted, sends to all users with tokens
 * @param {string} [params.type] - "broadcast" | "targeted" | "contact_response"
 * @param {string} [params.sentBy] - Admin ID
 */
async function sendPushNotification({ title, body, data = {}, userIds, type = "broadcast", sentBy = null }) {
  const { Expo, expo } = await getExpo();

  // Build query for users with valid push tokens
  const query = { expoPushToken: { $ne: null } };
  if (userIds && userIds.length > 0) {
    query._id = { $in: userIds };
  }

  const users = await User.find(query).select("_id expoPushToken");

  if (users.length === 0) return null;

  // Build messages
  const messages = [];
  const recipientIds = [];

  for (const user of users) {
    if (!Expo.isExpoPushToken(user.expoPushToken)) continue;

    recipientIds.push(user._id);
    messages.push({
      to: user.expoPushToken,
      sound: "default",
      title,
      body,
      data,
    });
  }

  // Send in chunks
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      console.error("Push notification chunk error:", err);
    }
  }

  // Create notification record
  const notification = await Notification.create({
    title,
    body,
    data,
    type,
    recipients: recipientIds,
    recipientCount: recipientIds.length,
    sentBy,
  });

  return notification;
}

module.exports = { sendPushNotification };
