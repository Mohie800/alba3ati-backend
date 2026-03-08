const Room = require("../models/room.model");
const {
  startGracePeriod,
  clearAllGracePeriodsForRoom,
  startWaitingGracePeriod,
} = require("../game/disconnect.game");
const { cancelTimer } = require("../game/timer.game");
const {
  handleQuickPlayLeave,
  evaluateCountdown,
} = require("../game/quickPlay.game");
const { QUICK_PLAY_GRACE_PERIOD } = require("../../utils/constants");

const getActiveRooms = async () => {
  try {
    const activeRooms = await Room.find({
      status: "waiting",
      isPublic: true,
      isQuickPlay: { $ne: true },
    }).populate("players.player");
    return activeRooms;
  } catch (error) {
    console.error("Error fetching active rooms:", error);
    throw error;
  }
};

const getSocketCount = (io, roomId) => {
  const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
  return socketsInRoom ? socketsInRoom.size : 0;
};

const joinRoom = async (io, socket, roomId) => {
  socket.join(roomId);
  // Sync activePlayers from Socket.IO (source of truth)
  const count = getSocketCount(io, roomId);
  await Room.updateOne({ roomId }, { $set: { activePlayers: count } });
};

const leaveRoom = async (io, socket, roomId, playerId, intentional = false) => {
  socket.leave(roomId);

  const count = getSocketCount(io, roomId);

  const room = await Room.findOne({ roomId }).populate("players.player");
  if (!room) return;

  if (room.status === "waiting") {
    // Quick play rooms: no host privileges
    if (room.isQuickPlay) {
      if (playerId && intentional) {
        // Intentional leave: immediate removal
        await handleQuickPlayLeave(io, roomId, playerId);
        return;
      } else if (playerId && !intentional) {
        // Unintentional disconnect: short grace period
        startWaitingGracePeriod(io, roomId, playerId, QUICK_PLAY_GRACE_PERIOD);
        room.activePlayers = count;
        await room.save();
        return;
      }
      return;
    }

    if (playerId && !intentional) {
      // Unintentional disconnect: give the player time to reconnect
      startWaitingGracePeriod(io, roomId, playerId);
      room.activePlayers = count;
      await room.save();
      // Update public rooms list so the room reflects current state
      if (room.isPublic) {
        const rooms = await getActiveRooms();
        io.emit("roomsUpdate", rooms);
      }
      return;
    }

    // Intentional leave: remove player immediately
    if (playerId) {
      const wasHost = room.host === playerId;

      // If the host leaves, end the room and kick everyone
      if (wasHost) {
        clearAllGracePeriodsForRoom(roomId);
        cancelTimer(roomId);
        room.status = "ended";
        room.activePlayers = 0;
        await room.save();
        io.to(roomId).emit("roomClosed");
        const rooms = await getActiveRooms();
        io.emit("roomsUpdate", rooms);
        return;
      }

      room.players = room.players.filter(
        (p) => p.player._id.toString() !== playerId
      );
    }
  } else if (room.status === "playing" && playerId) {
    // Mid-game: start grace period instead of removing player
    const graceDuration = room.isQuickPlay ? QUICK_PLAY_GRACE_PERIOD : undefined;
    startGracePeriod(io, roomId, playerId, graceDuration);
  }

  room.activePlayers = count;

  if (count === 0) {
    clearAllGracePeriodsForRoom(roomId);
    cancelTimer(roomId);
    room.status = "ended";
    await room.save();
    const rooms = await getActiveRooms();
    io.emit("roomsUpdate", rooms);
  } else {
    await room.save();

    // Notify remaining players so their UI updates
    io.to(roomId).emit("playerLeft", room);
  }
};

const publicRoom = async (io, socket, { roomId, isPublic }) => {
  try {
    const room = await Room.findOneAndUpdate(
      { roomId },
      { isPublic: !isPublic },
      { new: true }
    ).populate("players.player");
    if (!room) {
      return socket.emit("roomNotFound", { message: "Room not found" });
    }
    socket.emit("roomUpdated", room);
    const rooms = await getActiveRooms();
    io.emit("roomsUpdate", rooms);
    return;
  } catch (error) {
    console.error("Error updating room status:", error);
    throw error;
  }
};

module.exports = { getActiveRooms, joinRoom, leaveRoom, publicRoom };
