const Room = require("../models/room.model");
const {
  startGracePeriod,
  clearAllGracePeriodsForRoom,
  startWaitingGracePeriod,
} = require("../game/disconnect.game");
const { cancelTimer } = require("../game/timer.game");

const getActiveRooms = async () => {
  try {
    const activeRooms = await Room.find({
      status: "waiting",
      isPublic: true,
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

  let hostMigrated = false;

  if (room.status === "waiting") {
    if (playerId && !intentional) {
      // Unintentional disconnect: give the player time to reconnect
      startWaitingGracePeriod(io, roomId, playerId);
      room.activePlayers = count;
      await room.save();
      return;
    }

    // Intentional leave: remove player immediately
    if (playerId) {
      const wasHost = room.host === playerId;
      room.players = room.players.filter(
        (p) => p.player._id.toString() !== playerId
      );

      // Host migration: if the leaving player is the host, transfer to next player
      if (wasHost && room.players.length > 0) {
        room.host = room.players[0].player._id.toString();
        hostMigrated = true;
      }
    }
  } else if (room.status === "playing" && playerId) {
    // Mid-game: start grace period instead of removing player
    startGracePeriod(io, roomId, playerId);
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

    if (hostMigrated) {
      io.to(roomId).emit("hostMigrated", { newHostId: room.host, room });
    }

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
