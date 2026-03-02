const Room = require("../models/room.model");
const { GRACE_PERIOD } = require("../../utils/constants");

// In-memory store: playerId -> { timerId, roomId }
const gracePeriods = new Map();

// Waiting-room grace periods: playerId -> { timerId, roomId }
const waitingGracePeriods = new Map();

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
  for (const [playerId, entry] of waitingGracePeriods.entries()) {
    if (entry.roomId === roomId) {
      clearTimeout(entry.timerId);
      waitingGracePeriods.delete(playerId);
    }
  }
};

// ---- Waiting-room grace period (lobby disconnect) ----

const WAITING_GRACE_PERIOD = 15; // seconds

const startWaitingGracePeriod = (io, roomId, playerId) => {
  if (waitingGracePeriods.has(playerId)) return;

  const timerId = setTimeout(() => {
    handleWaitingGracePeriodExpiry(io, roomId, playerId);
  }, WAITING_GRACE_PERIOD * 1000);

  waitingGracePeriods.set(playerId, { timerId, roomId });
  console.log(
    `[Disconnect] Waiting grace period started for ${playerId} in room ${roomId}`
  );
};

const cancelWaitingGracePeriod = (roomId, playerId) => {
  const entry = waitingGracePeriods.get(playerId);
  if (!entry) return;

  clearTimeout(entry.timerId);
  waitingGracePeriods.delete(playerId);
  console.log(
    `[Disconnect] Waiting grace period canceled for ${playerId} in room ${roomId}`
  );
};

const isPlayerInWaitingGracePeriod = (playerId) => {
  return waitingGracePeriods.has(playerId);
};

const handleWaitingGracePeriodExpiry = async (io, roomId, playerId) => {
  waitingGracePeriods.delete(playerId);

  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room || room.status !== "waiting") return;

    const wasHost = room.host === playerId;

    // Remove the player
    room.players = room.players.filter(
      (p) => p.player._id.toString() !== playerId
    );

    if (room.players.length === 0) {
      // No players left — end the room
      clearAllGracePeriodsForRoom(roomId);
      const { cancelTimer } = require("../game/timer.game");
      cancelTimer(roomId);
      room.status = "ended";
      await room.save();
      const activeRooms = await Room.find({
        status: "waiting",
        isPublic: true,
      }).populate("players.player");
      io.emit("roomsUpdate", activeRooms);
    } else {
      // Host migration if needed
      if (wasHost) {
        room.host = room.players[0].player._id.toString();
        io.to(roomId).emit("hostMigrated", {
          newHostId: room.host,
          room,
        });
      }
      await room.save();
      io.to(roomId).emit("playerLeft", room);
      const activeRooms = await Room.find({
        status: "waiting",
        isPublic: true,
      }).populate("players.player");
      io.emit("roomsUpdate", activeRooms);
    }

    console.log(
      `[Disconnect] Waiting grace period expired for ${playerId} — removed from room ${roomId}`
    );
  } catch (error) {
    console.error(
      "[Disconnect] Error handling waiting grace period expiry:",
      error
    );
  }
};

module.exports = {
  startGracePeriod,
  cancelGracePeriod,
  handleGracePeriodExpiry,
  isPlayerInGracePeriod,
  clearAllGracePeriodsForRoom,
  startWaitingGracePeriod,
  cancelWaitingGracePeriod,
  isPlayerInWaitingGracePeriod,
};
