const Room = require("../models/room.model");

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

const leaveRoom = async (io, socket, roomId, playerId) => {
  socket.leave(roomId);

  const count = getSocketCount(io, roomId);

  const room = await Room.findOne({ roomId }).populate("players.player");
  if (!room) return;

  // Remove the player from the room's players array (lobby only)
  if (playerId && room.status === "waiting") {
    room.players = room.players.filter(
      (p) => p.player._id.toString() !== playerId
    );
  }

  room.activePlayers = count;

  if (count === 0) {
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
