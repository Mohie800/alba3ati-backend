// In-memory presence tracking
// presence: Map<userId, { status: 'online'|'playing', roomId?: string, lastSeen: Date }>
const presenceMap = new Map();

// Friends list cache: Map<userId, { friends: string[], expiresAt: number }>
const friendsCache = new Map();
const FRIENDS_CACHE_TTL = 60 * 1000; // 60 seconds

function setOnline(userId) {
  presenceMap.set(userId, { status: "online", lastSeen: new Date() });
}

function setPlaying(userId, roomId) {
  presenceMap.set(userId, { status: "playing", roomId, lastSeen: new Date() });
}

function setOffline(userId) {
  presenceMap.delete(userId);
}

function getPresence(userId) {
  return presenceMap.get(userId) || { status: "offline" };
}

function getMultiplePresence(userIds) {
  const result = {};
  for (const userId of userIds) {
    result[userId] = getPresence(userId);
  }
  return result;
}

function isOnline(userId) {
  return presenceMap.has(userId);
}

// Friends list cache helpers
function getCachedFriends(userId) {
  const cached = friendsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.friends;
  }
  friendsCache.delete(userId);
  return null;
}

function setCachedFriends(userId, friends) {
  friendsCache.set(userId, {
    friends,
    expiresAt: Date.now() + FRIENDS_CACHE_TTL,
  });
}

function invalidateFriendsCache(userId) {
  friendsCache.delete(userId);
}

// Periodic sweep of expired cache entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of friendsCache) {
    if (entry.expiresAt <= now) friendsCache.delete(key);
  }
}, 5 * 60 * 1000);

module.exports = {
  setOnline,
  setPlaying,
  setOffline,
  getPresence,
  getMultiplePresence,
  isOnline,
  getCachedFriends,
  setCachedFriends,
  invalidateFriendsCache,
};
