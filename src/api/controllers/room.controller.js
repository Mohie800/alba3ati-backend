const Room = require("../models/room.model");

exports.getActiveRooms = async () => {
  try {
    // Fetch all active rooms
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

exports.joinRoom = async (io, socket, roomId) => {
  socket.join(roomId);
  const room = await Room.findOne({ roomId });
  if (!room) {
    return socket.emit("roomNotFound", { message: "Room not found" });
  }
  room.activePlayers = room.activePlayers + 1;
  await room.save();
  return;
};

exports.leaveRoom = async (io, socket, roomId) => {
  socket.leave(roomId);
  const room = await Room.findOne({ roomId });
  if (!room) {
    return socket.emit("roomNotFound", { message: "Room not found" });
  }
  room.activePlayers = room.activePlayers - 1;
  if (room.activePlayers === 0) {
    room.status = "ended";
    const rooms = await this.getActiveRooms();
    io.emit(
      "roomsUpdate",
      rooms.filter((room) => room.roomId === roomId)
    );
  }
  await room.save();
  return;
};

exports.publicRoom = async (io, socket, { roomId, isPublic }) => {
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
    const rooms = await this.getActiveRooms();
    io.emit("roomsUpdate", rooms);
    return;
  } catch (error) {
    console.error("Error updating room status:", error);
    throw error;
  }
};
