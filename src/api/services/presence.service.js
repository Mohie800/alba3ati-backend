// In-memory presence tracking
// presenceMap: Map<string(userId), { status: 'online'|'playing', roomId?: string }>
const presenceMap = new Map();

// Debounce timers for offline transitions (prevents flicker on brief disconnects)
// pendingOffline: Map<string(userId), timeoutId>
const pendingOffline = new Map();
const OFFLINE_DEBOUNCE_MS = 5000;

// Friends list cache: Map<string(userId), { friends: string[], expiresAt: number }>
const friendsCache = new Map();
const FRIENDS_CACHE_TTL = 60 * 1000;

// --- Key normalization (all Map keys are strings) ---
function normalize(userId) {
  return userId?.toString();
}

// --- Presence state ---

function setOnline(userId) {
  const id = normalize(userId);
  cancelPendingOffline(id);
  presenceMap.set(id, { status: "online" });
}

function setPlaying(userId, roomId) {
  const id = normalize(userId);
  cancelPendingOffline(id);
  presenceMap.set(id, { status: "playing", roomId });
}

function setOffline(userId) {
  const id = normalize(userId);
  cancelPendingOffline(id);
  presenceMap.delete(id);
}

/**
 * Debounced offline: waits OFFLINE_DEBOUNCE_MS before marking offline.
 * If the user reconnects before the timer fires, cancelPendingOffline is
 * called (via setOnline/setPlaying) and the offline transition never happens.
 * @param {string} userId
 * @param {function} [onOffline] - callback(normalizedId) when actually going offline
 */
function scheduleOffline(userId, onOffline) {
  const id = normalize(userId);
  if (pendingOffline.has(id)) return; // already scheduled
  const timer = setTimeout(() => {
    pendingOffline.delete(id);
    presenceMap.delete(id);
    if (onOffline) onOffline(id);
  }, OFFLINE_DEBOUNCE_MS);
  pendingOffline.set(id, timer);
}

function cancelPendingOffline(userId) {
  const id = normalize(userId);
  const timer = pendingOffline.get(id);
  if (timer) {
    clearTimeout(timer);
    pendingOffline.delete(id);
  }
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
);

function getOnlineCount() {
  return presenceMap.size;
}

module.exports = {
  setOnline,
  setPlaying,
  setOffline,
  scheduleOffline,
  cancelPendingOffline,
  getPresence,
  getMultiplePresence,
  isOnline,
  getCachedFriends,
  setCachedFriends,
  invalidateFriendsCache,
  getOnlineCount,
};
