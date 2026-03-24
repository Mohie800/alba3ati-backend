const Room = require("../models/room.model");

// In-memory store of muted player IDs per room
const mutedPlayers = new Map(); // roomId -> Set of playerIds

exports.mutePlayerToggle = async (io, socket, { roomId, targetId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    // Only the host can mute players
    if (socket.playerId !== room.host) return;

    // Only during discussion phase
    if (room.gamePhase !== "discussion") return;

    // Cannot mute yourself
    if (targetId === room.host) return;

    // Target must be alive in the room
    const target = room.players.find(
      (p) => p.player._id.toString() === targetId && p.status === "alive",
    );
    if (!target) return;

    if (!mutedPlayers.has(roomId)) {
      mutedPlayers.set(roomId, new Set());
    }

    const muted = mutedPlayers.get(roomId);
    const isMuted = muted.has(targetId);

    if (isMuted) {
      muted.delete(targetId);
    } else {
      muted.add(targetId);
    }

    io.to(roomId).emit("playerMuted", {
      targetId,
      isMuted: !isMuted,
      mutedPlayerIds: Array.from(muted),
    });
  } catch (error) {
    console.error("mutePlayer error:", error);
  }
};

exports.clearMutedPlayers = (roomId) => {
  mutedPlayers.delete(roomId);
};

exports.getMutedPlayers = (roomId) => {
  return mutedPlayers.has(roomId) ? Array.from(mutedPlayers.get(roomId)) : [];
};
