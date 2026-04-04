const Friendship = require("../models/friendship.model");
const User = require("../models/user.model");
const {
  invalidateFriendsCache,
  getCachedFriends,
  setCachedFriends,
  getPresence,
  isOnline,
} = require("./presence.service");
const { sendFriendRequestNotification } = require("./pushNotification.service");

// Will be injected after socket.io initializes to avoid circular dependency
let emitToUser = null;
function setEmitToUser(fn) {
  emitToUser = fn;
}

// Throttle map for friendJoinedRoom notifications: Map<`${userId}:${friendId}`, expiresAt>
const notifyThrottle = new Map();
const NOTIFY_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FRIENDS = 200;

// Periodic sweep of expired throttle entries (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of notifyThrottle) {
    if (expiresAt <= now) notifyThrottle.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * Send a friend request from userId to targetUserId.
 */
async function sendRequest(userId, targetUserId) {
  if (userId === targetUserId) {
    throw Object.assign(new Error("لا يمكنك إضافة نفسك"), { status: 400 });
  }

  // Check both users exist
  const [user, target] = await Promise.all([
    User.findById(userId).select("name frame stats friendCount"),
    User.findById(targetUserId).select("name frame stats friendCount notificationPreferences expoPushToken"),
  ]);
  if (!user || !target) {
    throw Object.assign(new Error("المستخدم غير موجود"), { status: 404 });
  }

  // Check max friends limit
  if ((user.friendCount || 0) >= MAX_FRIENDS || (target.friendCount || 0) >= MAX_FRIENDS) {
    throw Object.assign(new Error("تم الوصول للحد الأقصى من الأصدقاء"), { status: 400 });
  }

  // Check for existing friendship in either direction
  const existing = await Friendship.findOne({
    $or: [
      { requester: userId, recipient: targetUserId },
      { requester: targetUserId, recipient: userId },
    ],
  });

  if (existing) {
    if (existing.status === "accepted") {
      throw Object.assign(new Error("أنتما أصدقاء بالفعل"), { status: 400 });
    }
    if (existing.status === "blocked") {
      throw Object.assign(new Error("لا يمكن إرسال طلب صداقة"), { status: 400 });
    }
    // If target already sent a request to this user, auto-accept
    if (
      existing.status === "pending" &&
      existing.requester.toString() === targetUserId
    ) {
      existing.status = "accepted";
      existing.acceptedAt = new Date();
      await existing.save();

      await Promise.all([
        User.findByIdAndUpdate(userId, { $inc: { friendCount: 1 } }),
        User.findByIdAndUpdate(targetUserId, { $inc: { friendCount: 1 } }),
      ]);

      invalidateFriendsCache(userId);
      invalidateFriendsCache(targetUserId);

      // Notify both parties
      if (emitToUser) {
        const presence = getPresence(userId);
        emitToUser(targetUserId, "friendRequestAccepted", {
          friend: {
            _id: user._id,
            name: user.name,
            frame: user.frame,
            stats: user.stats,
            presence,
          },
        });
      }

      return { autoAccepted: true };
    }
    // Duplicate pending request
    throw Object.assign(new Error("الطلب مُرسَل بالفعل"), { status: 400 });
  }

  // Create new pending request
  await Friendship.create({ requester: userId, recipient: targetUserId });

  // Emit real-time event to target
  if (emitToUser) {
    emitToUser(targetUserId, "friendRequestReceived", {
      from: {
        _id: user._id,
        name: user.name,
        frame: user.frame,
        stats: user.stats,
      },
    });

    // Update pending count for target
    const pendingCount = await Friendship.countDocuments({
      recipient: targetUserId,
      status: "pending",
    });
    emitToUser(targetUserId, "pendingRequestCount", { count: pendingCount });
  }

  // Send push notification to offline target
  if (target.notificationPreferences?.friendRequests !== false) {
    sendFriendRequestNotification(user.name, targetUserId).catch(() => {});
  }

  return { sent: true };
}

/**
 * Accept a pending friend request.
 */
async function acceptRequest(userId, requesterId) {
  const friendship = await Friendship.findOne({
    requester: requesterId,
    recipient: userId,
    status: "pending",
  });

  if (!friendship) {
    throw Object.assign(new Error("طلب الصداقة غير موجود"), { status: 404 });
  }

  friendship.status = "accepted";
  friendship.acceptedAt = new Date();
  await friendship.save();

  await Promise.all([
    User.findByIdAndUpdate(userId, { $inc: { friendCount: 1 } }),
    User.findByIdAndUpdate(requesterId, { $inc: { friendCount: 1 } }),
  ]);

  invalidateFriendsCache(userId);
  invalidateFriendsCache(requesterId);

  // Notify requester
  if (emitToUser) {
    const accepter = await User.findById(userId).select("name frame stats");
    const presence = getPresence(userId);
    emitToUser(requesterId, "friendRequestAccepted", {
      friend: {
        _id: accepter._id,
        name: accepter.name,
        frame: accepter.frame,
        stats: accepter.stats,
        presence,
      },
    });

    // Update pending count for the accepter
    const pendingCount = await Friendship.countDocuments({
      recipient: userId,
      status: "pending",
    });
    emitToUser(userId, "pendingRequestCount", { count: pendingCount });
  }

  return { accepted: true };
}

/**
 * Decline or cancel a friend request.
 */
async function declineRequest(userId, requesterId) {
  const result = await Friendship.findOneAndDelete({
    requester: requesterId,
    recipient: userId,
    status: "pending",
  });

  if (!result) {
    throw Object.assign(new Error("طلب الصداقة غير موجود"), { status: 404 });
  }

  // Subtle notification to requester
  if (emitToUser) {
    emitToUser(requesterId, "friendRequestDeclined", { userId });

    const pendingCount = await Friendship.countDocuments({
      recipient: userId,
      status: "pending",
    });
    emitToUser(userId, "pendingRequestCount", { count: pendingCount });
  }

  return { declined: true };
}

/**
 * Cancel an outgoing friend request (sender cancels).
 */
async function cancelRequest(userId, targetUserId) {
  const result = await Friendship.findOneAndDelete({
    requester: userId,
    recipient: targetUserId,
    status: "pending",
  });

  if (!result) {
    throw Object.assign(new Error("الطلب غير موجود"), { status: 404 });
  }

  return { cancelled: true };
}

/**
 * Remove an existing friend.
 */
async function removeFriend(userId, friendId) {
  const result = await Friendship.findOneAndDelete({
    status: "accepted",
    $or: [
      { requester: userId, recipient: friendId },
      { requester: friendId, recipient: userId },
    ],
  });

  if (!result) {
    throw Object.assign(new Error("هذا الشخص ليس في قائمة أصدقائك"), { status: 404 });
  }

  await Promise.all([
    User.updateOne({ _id: userId, friendCount: { $gt: 0 } }, { $inc: { friendCount: -1 } }),
    User.updateOne({ _id: friendId, friendCount: { $gt: 0 } }, { $inc: { friendCount: -1 } }),
  ]);

  invalidateFriendsCache(userId);
  invalidateFriendsCache(friendId);

  if (emitToUser) {
    emitToUser(friendId, "friendRemoved", { userId });
  }

  return { removed: true };
}

/**
 * Block a player.
 */
async function blockPlayer(userId, targetUserId) {
  if (userId === targetUserId) {
    throw Object.assign(new Error("لا يمكنك حظر نفسك"), { status: 400 });
  }

  // Check if the target already blocked this user — don't let them reverse it
  const existingBlock = await Friendship.findOne({
    requester: targetUserId,
    recipient: userId,
    status: "blocked",
  });
  if (existingBlock) {
    // Target already blocked us — just add our own block record without deleting theirs
    // Use upsert to avoid duplicate key error if we already have a block record
    await Friendship.findOneAndUpdate(
      { requester: userId, recipient: targetUserId },
      { $set: { status: "blocked" } },
      { upsert: true },
    );
    return { blocked: true };
  }

  // Remove any existing friendship/pending request first
  const existing = await Friendship.findOneAndDelete({
    $or: [
      { requester: userId, recipient: targetUserId },
      { requester: targetUserId, recipient: userId },
    ],
  });

  // If they were friends, decrement friendCount on both
  if (existing && existing.status === "accepted") {
    await Promise.all([
      User.updateOne({ _id: userId, friendCount: { $gt: 0 } }, { $inc: { friendCount: -1 } }),
      User.updateOne({ _id: targetUserId, friendCount: { $gt: 0 } }, { $inc: { friendCount: -1 } }),
    ]);
  }

  invalidateFriendsCache(userId);
  invalidateFriendsCache(targetUserId);

  // Create block record
  await Friendship.create({
    requester: userId,
    recipient: targetUserId,
    status: "blocked",
  });

  return { blocked: true };
}

/**
 * Unblock a player.
 */
async function unblockPlayer(userId, targetUserId) {
  const result = await Friendship.findOneAndDelete({
    requester: userId,
    recipient: targetUserId,
    status: "blocked",
  });

  if (!result) {
    throw Object.assign(new Error("لم يتم حظر هذا المستخدم"), { status: 404 });
  }

  return { unblocked: true };
}

/**
 * Get paginated friends list with presence.
 */
async function getFriends(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const filter = {
    status: "accepted",
    $or: [{ requester: userId }, { recipient: userId }],
  };

  const [friendships, total] = await Promise.all([
    Friendship.find(filter)
      .populate([
        {
          path: "requester",
          select: "name frame stats",
          match: { _id: { $ne: userId } },
        },
        {
          path: "recipient",
          select: "name frame stats",
          match: { _id: { $ne: userId } },
        },
      ])
      .skip(skip)
      .limit(limit)
      .lean(),
    Friendship.countDocuments(filter),
  ]);

  const friends = friendships.map((f) => {
    const friend = f.requester?._id?.toString() !== userId ? f.requester : f.recipient;
    if (!friend) return null;
    return {
      _id: friend._id,
      name: friend.name,
      frame: friend.frame,
      stats: friend.stats,
      presence: getPresence(friend._id.toString()),
    };
  }).filter(Boolean);

  // Sort: playing first, then online, then offline
  const order = { playing: 0, online: 1, offline: 2 };
  friends.sort((a, b) => {
    const ao = order[a.presence.status] ?? 2;
    const bo = order[b.presence.status] ?? 2;
    if (ao !== bo) return ao - bo;
    return (a.name || "").localeCompare(b.name || "");
  });

  return { friends, total, page, limit };
}

/**
 * Get pending incoming friend requests.
 */
async function getIncomingRequests(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const requests = await Friendship.find({
    recipient: userId,
    status: "pending",
  })
    .populate("requester", "name frame stats")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return requests.map((r) => ({
    _id: r._id,
    from: r.requester,
    createdAt: r.createdAt,
  }));
}

/**
 * Get pending outgoing friend requests.
 */
async function getOutgoingRequests(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const requests = await Friendship.find({
    requester: userId,
    status: "pending",
  })
    .populate("recipient", "name frame stats")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return requests.map((r) => ({
    _id: r._id,
    to: r.recipient,
    createdAt: r.createdAt,
  }));
}

/**
 * Get friendship statuses between userId and multiple target IDs.
 * Returns { [targetUserId]: 'none'|'pending_sent'|'pending_received'|'accepted'|'blocked' }
 */
async function getBatchStatus(userId, targetUserIds) {
  if (targetUserIds.length > 20) {
    throw Object.assign(new Error("الحد الأقصى 20 مستخدم"), { status: 400 });
  }

  const friendships = await Friendship.find({
    $or: [
      { requester: userId, recipient: { $in: targetUserIds } },
      { requester: { $in: targetUserIds }, recipient: userId },
    ],
  }).lean();

  const statuses = {};
  for (const targetId of targetUserIds) {
    statuses[targetId] = "none";
  }

  for (const f of friendships) {
    const requesterId = f.requester.toString();
    const recipientId = f.recipient.toString();
    const otherId = requesterId === userId ? recipientId : requesterId;

    if (f.status === "accepted") {
      statuses[otherId] = "accepted";
    } else if (f.status === "blocked") {
      // Mask block status — don't reveal who blocked whom
      statuses[otherId] = "none";
    } else if (f.status === "pending") {
      if (requesterId === userId) {
        statuses[otherId] = "pending_sent";
      } else {
        statuses[otherId] = "pending_received";
      }
    }
  }

  return statuses;
}

/**
 * Search players by name, with friendship status attached.
 */
async function searchPlayers(userId, query, page = 1, limit = 15) {
  if (!query || query.length < 2) {
    throw Object.assign(new Error("يجب أن يكون البحث حرفين على الأقل"), { status: 400 });
  }

  const skip = (page - 1) * limit;

  // Check if query looks like a MongoDB ObjectId (search by player ID)
  let users;
  if (/^[a-fA-F0-9]{24}$/.test(query.trim())) {
    const mongoose = require("mongoose");
    const targetId = query.trim();
    if (targetId === userId) return [];
    const user = await User.findById(targetId)
      .select("name frame stats")
      .lean();
    users = user ? [user] : [];
  } else {
    users = await User.find(
      { _id: { $ne: userId }, $text: { $search: query } },
      { score: { $meta: "textScore" } },
    )
      .select("name frame stats")
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  if (users.length === 0) return [];

  const targetIds = users.map((u) => u._id.toString());
  const statuses = await getBatchStatus(userId, targetIds);

  return users.map((u) => ({
    _id: u._id,
    name: u.name,
    frame: u.frame,
    stats: { gamesWon: u.stats?.gamesWon, gamesPlayed: u.stats?.gamesPlayed },
    friendshipStatus: statuses[u._id.toString()] || "none",
  }));
}

/**
 * Get friend IDs for a user (uses cache).
 */
async function getFriendIds(userId) {
  const cached = getCachedFriends(userId);
  if (cached) return cached;

  const friendships = await Friendship.find({
    status: "accepted",
    $or: [{ requester: userId }, { recipient: userId }],
  }).lean();

  const friendIds = friendships.map((f) => {
    const rid = f.requester.toString();
    const sid = f.recipient.toString();
    return rid === userId ? sid : rid;
  });

  setCachedFriends(userId, friendIds);
  return friendIds;
}

/**
 * Check if throttle allows a notification from fromUserId to toUserId.
 */
function checkAndSetNotifyThrottle(fromUserId, toUserId) {
  const key = `${fromUserId}:${toUserId}`;
  const expiry = notifyThrottle.get(key);
  if (expiry && expiry > Date.now()) return false;
  notifyThrottle.set(key, Date.now() + NOTIFY_THROTTLE_MS);
  return true;
}

module.exports = {
  setEmitToUser,
  sendRequest,
  acceptRequest,
  declineRequest,
  cancelRequest,
  removeFriend,
  blockPlayer,
  unblockPlayer,
  getFriends,
  getIncomingRequests,
  getOutgoingRequests,
  getBatchStatus,
  searchPlayers,
  getFriendIds,
  checkAndSetNotifyThrottle,
};
