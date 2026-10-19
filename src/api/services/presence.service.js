// Presence is derived from live sockets, never set directly:
//   no sockets (after debounce)         -> offline
//   a socket seated in a non-ended room -> playing (roomId, roomStatus)
//   otherwise                           -> online
// Callers only report facts (socket identified / left / changed room, room
// status changed) and call refreshSocket; listeners hear only real changes.

const { recordAppUser } = require("../game/dailyStats.game");
const userSockets = new Map(); // userId -> Set<socket>
const presenceMap = new Map(); // userId -> { status, roomId?, roomStatus? }
const pendingOffline = new Map(); // userId -> timeout
const roomStatuses = new Map(); // roomId -> "waiting" | "playing" | "ended"
const OFFLINE_DEBOUNCE_MS = 5000;

let ioRef = null;
let changeListener = null;

// Friends list cache: Map<string(userId), { friends: string[], expiresAt: number }>
const friendsCache = new Map();
const FRIENDS_CACHE_TTL = 60 * 1000;

function normalize(userId) {
  return userId ? userId.toString() : null;
}

function init(io, onChange) {
  ioRef = io;
  changeListener = onChange;
}

function samePresence(a, b) {
  if (!a || !b) return a === b;
  return (
    a.status === b.status && a.roomId === b.roomId && a.roomStatus === b.roomStatus
  );
}

function compute(id) {
  const sockets = userSockets.get(id);
  if (!sockets || sockets.size === 0) return null;
  for (const s of sockets) {
    const roomId = s.gameRoomId;
    if (!roomId || s.isSpectator) continue;
    const roomStatus = roomStatuses.get(roomId) || "waiting";
    if (roomStatus === "ended") continue;
    return { status: "playing", roomId, roomStatus };
  }
  return { status: "online" };
}

function publish(id, next) {
  const prev = presenceMap.get(id) || null;
  if (samePresence(prev, next)) return;
  if (next) presenceMap.set(id, next);
  else presenceMap.delete(id);
  if (changeListener) {
    try {
      changeListener(id, next || { status: "offline" });
    } catch (err) {
      console.error("[Presence] change listener error:", err);
    }
  }
}

function refresh(userId) {
  const id = normalize(userId);
  if (!id) return;
  // While the offline debounce runs, keep showing the last known presence.
  if (!userSockets.get(id)?.size) return;
  publish(id, compute(id));
}

function cancelPendingOffline(id) {
  const timer = pendingOffline.get(id);
  if (timer) {
    clearTimeout(timer);
    pendingOffline.delete(id);
  }
}

// Bind a socket to a user. Re-binding to another user releases the old one,
// so an account switch on the same socket can't leave a ghost online.
function attachSocket(socket, userId) {
  const id = normalize(userId);
  if (!id) return;
  const current = socket.data.presenceUserId;
  if (current === id) {
    refresh(id);
    return;
  }
  if (current) detachSocket(socket);
  socket.data.presenceUserId = id;
  if (!userSockets.has(id)) userSockets.set(id, new Set());
  userSockets.get(id).add(socket);
  cancelPendingOffline(id);
  recordAppUser(id);
  refresh(id);
}

function detachSocket(socket) {
  const id = socket.data.presenceUserId;
  if (!id) return;
  socket.data.presenceUserId = null;
  const sockets = userSockets.get(id);
  if (sockets) sockets.delete(socket);
  if (sockets && sockets.size > 0) {
    refresh(id);
    return;
  }
  userSockets.delete(id);
  if (pendingOffline.has(id)) return;
  pendingOffline.set(
    id,
    setTimeout(() => {
      pendingOffline.delete(id);
      if (userSockets.get(id)?.size) return;
      publish(id, null);
    }, OFFLINE_DEBOUNCE_MS),
  );
}

function refreshSocket(socket) {
  const id = socket.data.presenceUserId;
  if (id) refresh(id);
}

function setRoomStatus(roomId, status) {
  if (!roomId) return;
  if (roomStatuses.get(roomId) === status) return;
  roomStatuses.set(roomId, status);
  const members = ioRef?.sockets.adapter.rooms.get(roomId);
  if (!members) return;
  for (const sid of members) {
    const s = ioRef.sockets.sockets.get(sid);
    if (s) refreshSocket(s);
  }
}

function getSocketIds(userId) {
  const sockets = userSockets.get(normalize(userId));
  return sockets ? [...sockets].map((s) => s.id) : [];
}

function getPresence(userId) {
  return presenceMap.get(normalize(userId)) || { status: "offline" };
}

function getMultiplePresence(userIds) {
  const result = {};
  for (const uid of userIds) {
    result[uid] = getPresence(uid);
  }
  return result;
}

function isOnline(userId) {
  return presenceMap.has(normalize(userId));
}

// --- Friends list cache helpers ---

function getCachedFriends(userId) {
  const id = normalize(userId);
  const cached = friendsCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.friends;
  friendsCache.delete(id);
  return null;
}

function setCachedFriends(userId, friends) {
  friendsCache.set(normalize(userId), {
    friends,
    expiresAt: Date.now() + FRIENDS_CACHE_TTL,
  });
}

function invalidateFriendsCache(userId) {
  friendsCache.delete(normalize(userId));
}

// Periodic sweep of expired cache entries (every 5 minutes)
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of friendsCache) {
      if (entry.expiresAt <= now) friendsCache.delete(key);
    }
  },
  5 * 60 * 1000,
).unref();

function getOnlineCount() {
  return presenceMap.size;
}

// Distinct signed-in users with a live socket (no offline-debounce stragglers)
function getConnectedUserCount() {
  return userSockets.size;
}

function getOnlinePlayers() {
  const result = [];
  for (const [userId, presence] of presenceMap) {
    result.push({ userId, ...presence });
  }
  return result;
}

module.exports = {
  init,
  attachSocket,
  detachSocket,
  refreshSocket,
  setRoomStatus,
  getSocketIds,
  getPresence,
  getMultiplePresence,
  isOnline,
  getCachedFriends,
  setCachedFriends,
  invalidateFriendsCache,
  getOnlineCount,
  getConnectedUserCount,
  getOnlinePlayers,
};
