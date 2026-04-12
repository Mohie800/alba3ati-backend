const Room = require("../models/room.model");

// In-memory store of declared roles per room: roomId -> Map<playerId, declaredRoleId>
const roomDeclarations = new Map();

exports.handleDeclareRole = async (
  io,
  socket,
  { roomId, playerId, declaredRoleId },
) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    // Only during discussion phase
    if (room.gamePhase !== "discussion") return;

    // Player must be in the room
    const player = room.players.find(
      (p) => p.player._id.toString() === playerId,
    );
    if (!player) return;

    if (!roomDeclarations.has(roomId)) {
      roomDeclarations.set(roomId, new Map());
    }

    const declarations = roomDeclarations.get(roomId);

    if (declaredRoleId === null || declaredRoleId === undefined) {
      // Cancel declaration
      declarations.delete(playerId);
    } else {
      declarations.set(playerId, declaredRoleId);
    }

    // Broadcast the full declarations map as a plain object
    const declarationsObj = Object.fromEntries(declarations);
    io.to(roomId).emit("roleDeclared", {
      playerId,
      declaredRoleId,
      declarations: declarationsObj,
    });
  } catch (error) {
    console.error("declareRole error:", error);
  }
};

exports.clearRoleDeclarations = (roomId) => {
  roomDeclarations.delete(roomId);
};

exports.getRoleDeclarations = (roomId) => {
  const declarations = roomDeclarations.get(roomId);
  if (!declarations) return {};
  return Object.fromEntries(declarations);
};
