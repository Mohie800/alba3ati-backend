const Room = require("../models/room.model");
const { pidOf } = require("./roomUtils");
const { withRoomLock } = require("./roomLock");

// Muted player ids live on the room (`mutedPlayers`) so they survive a restart.
exports.mutePlayerToggle = (io, socket, { roomId, targetId } = {}) => {
  if (!roomId || !targetId) return;
  return withRoomLock(roomId, async () => {
    try {
      const room = await Room.findOne({ roomId }, "players host gamePhase mutedPlayers");
      if (!room) return;

      // Only the host can mute players
      if (socket.playerId !== room.host) return;

      // Only during discussion phase
      if (room.gamePhase !== "discussion") return;

      // Cannot mute yourself
      if (targetId === room.host) return;

      // Target must be alive in the room
      const target = room.players.find(
        (p) => pidOf(p) === targetId && p.status === "alive",
      );
      if (!target) return;

      const isMuted = room.mutedPlayers.includes(targetId);
      room.mutedPlayers = isMuted
        ? room.mutedPlayers.filter((id) => id !== targetId)
        : [...room.mutedPlayers, targetId];
      await room.save();

      io.to(roomId).emit("playerMuted", {
        targetId,
        isMuted: !isMuted,
        mutedPlayerIds: [...room.mutedPlayers],
      });
    } catch (error) {
      console.error("mutePlayer error:", error);
    }
  });
};

exports.getMutedPlayers = (room) => [...(room.mutedPlayers || [])];
