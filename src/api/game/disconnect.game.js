const Room = require("../models/room.model");
const { GRACE_PERIOD } = require("../../utils/constants");

// In-memory store: playerId -> { timerId, roomId }
const gracePeriods = new Map();

/**
 * Start a 30s grace period for a disconnected player.
 * Emits `playerDisconnected` so other clients can show a badge.
 */
const startGracePeriod = (io, roomId, playerId) => {
  // Don't start a duplicate grace period
  if (gracePeriods.has(playerId)) return;

  const timerId = setTimeout(() => {
    handleGracePeriodExpiry(io, roomId, playerId);
  }, GRACE_PERIOD * 1000);

  gracePeriods.set(playerId, { timerId, roomId });

  io.to(roomId).emit("playerDisconnected", { playerId });
  console.log(
    `[Disconnect] Grace period started for ${playerId} in room ${roomId}`
  );
};

/**
 * Cancel the grace period when a player reconnects within 30s.
 * Emits `playerReconnected` so clients can remove the badge.
 */
const cancelGracePeriod = (io, roomId, playerId) => {
  const entry = gracePeriods.get(playerId);
  if (!entry) return;

  clearTimeout(entry.timerId);
  gracePeriods.delete(playerId);

  io.to(roomId).emit("playerReconnected", { playerId });
  console.log(
    `[Disconnect] Grace period canceled for ${playerId} in room ${roomId}`
  );
};

/**
 * Called when the 30s grace period expires without reconnection.
 * Marks the player as dead + done, then checks if the game phase can resolve.
 */
const handleGracePeriodExpiry = async (io, roomId, playerId) => {
  gracePeriods.delete(playerId);

  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room || room.status !== "playing") return;

    const player = room.players.find(
      (p) => p.player._id.toString() === playerId
    );
    if (!player || player.status === "dead") return;

    // Mark the disconnected player as dead and done
    player.status = "dead";
    player.playStatus = "done";
    await room.save();

    // Remove from skip-discussion votes and re-check threshold
    const { removePlayerSkipVote } = require("./skipDiscussion.game");
    removePlayerSkipVote(roomId, playerId);

    // Emit death event to room
    const updatedRoom = await Room.findOne({ roomId }).populate(
      "players.player"
    );
    io.to(roomId).emit("playerDisconnectDeath", {
      playerId,
      room: updatedRoom,
    });

    console.log(
      `[Disconnect] Grace period expired for ${playerId} — marked dead`
    );

    // Check if we can now resolve the current phase
    const alivePlayers = updatedRoom.players.filter(
      (p) => p.status === "alive"
    );

    // If no alive players remain, the room will end via activePlayers=0 logic
    if (alivePlayers.length === 0) return;

    const allDone = alivePlayers.every((p) => p.playStatus === "done");

    if (updatedRoom.votes.length > 0) {
      // We're in voting phase — check if all alive players voted
      if (allDone) {
        const { claculateVoteResult } = require("./claculateVoteResult.game");
        await claculateVoteResult(io, roomId);
      }
    } else if (allDone) {
      // We're in night phase — all alive players have acted
      const { claculateResult } = require("./calculate.game");
      await claculateResult(io, roomId);
    }
  } catch (error) {
    console.error("[Disconnect] Error handling grace period expiry:", error);
  }
};

/**
 * Returns true if the player is currently in a grace period (disconnected but not yet dead).
 */
const isPlayerInGracePeriod = (playerId) => {
  return gracePeriods.has(playerId);
};

/**
 * Clear all grace period timers for a given room (e.g. when the room ends).
 */
const clearAllGracePeriodsForRoom = (roomId) => {
  for (const [playerId, entry] of gracePeriods.entries()) {
    if (entry.roomId === roomId) {
      clearTimeout(entry.timerId);
      gracePeriods.delete(playerId);
    }
  }
};

module.exports = {
  startGracePeriod,
  cancelGracePeriod,
  handleGracePeriodExpiry,
  isPlayerInGracePeriod,
  clearAllGracePeriodsForRoom,
};
