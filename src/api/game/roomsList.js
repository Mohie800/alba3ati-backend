const Room = require("../models/room.model");

// Public rooms list: only what the public-rooms screen renders.
const getActiveRooms = async () => {
  const rooms = await Room.find(
    {
      status: { $in: ["waiting", "playing"] },
      isPublic: true,
      isQuickPlay: { $ne: true },
    },
    "roomId host status gamePhase isPublic isQuickPlay players.player createdAt",
  )
    .populate({
      path: "players.player",
      select: "name frame nameColor equippedProfilePicture",
    })
    .lean();
  for (const room of rooms) {
    room.players = room.players.filter((p) => p.player);
  }
  return rooms;
};

// Coalesces bursts of joins/leaves into at most one broadcast per window.
const BROADCAST_WINDOW_MS = 1000;
let lastBroadcastAt = 0;
let pendingTimer = null;

const broadcastNow = async (io) => {
  lastBroadcastAt = Date.now();
  try {
    io.emit("roomsUpdate", await getActiveRooms());
  } catch (err) {
    console.error("[roomsUpdate] broadcast failed:", err);
  }
};

const broadcastRoomsUpdate = (io) => {
  if (pendingTimer) return;
  const wait = Math.max(0, lastBroadcastAt + BROADCAST_WINDOW_MS - Date.now());
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    broadcastNow(io);
  }, wait);
};

module.exports = { getActiveRooms, broadcastRoomsUpdate };
