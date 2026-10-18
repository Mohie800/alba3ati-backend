const Room = require("../models/room.model");
const { findPlayer } = require("./roomUtils");
const { withRoomLock } = require("./roomLock");

// Declarations live on the room (`roleDeclarations`, playerId -> roleId) for
// the whole game, so they survive a restart.
exports.handleDeclareRole = (
  io,
  socket,
  { roomId, playerId, declaredRoleId } = {},
) => {
  if (!roomId || !playerId) return;
  return withRoomLock(roomId, async () => {
    try {
      const room = await Room.findOne({ roomId }, "players gamePhase roleDeclarations");
      if (!room) return;

      // Only during discussion phase
      if (room.gamePhase !== "discussion") return;

      // Player must be in the room
      if (!findPlayer(room, playerId)) return;

      if (declaredRoleId === null || declaredRoleId === undefined) {
        // Cancel declaration
        room.roleDeclarations.delete(playerId);
      } else {
        room.roleDeclarations.set(playerId, String(declaredRoleId));
      }
      await room.save();

      io.to(roomId).emit("roleDeclared", {
        playerId,
        declaredRoleId,
        declarations: exports.getRoleDeclarations(room),
      });
    } catch (error) {
      console.error("declareRole error:", error);
    }
  });
};

exports.getRoleDeclarations = (room) =>
  room.roleDeclarations ? Object.fromEntries(room.roleDeclarations) : {};
