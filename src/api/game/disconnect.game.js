const Room = require("../models/room.model");
const { GRACE_PERIOD } = require("../../utils/constants");
const { scheduleRoomTask } = require("./roomLock");
const { PLAYER_POPULATE, pidOf, findPlayer } = require("./roomUtils");
const { broadcastRoomsUpdate } = require("./roomsList");

// In-game grace periods: "roomId:playerId" -> { timerId, roomId, playerId }
const gracePeriods = new Map();

// Waiting-room grace periods: "roomId:playerId" -> { timerId, roomId, playerId }
const waitingGracePeriods = new Map();

const graceKey = (roomId, playerId) => `${roomId}:${playerId}`;

const findEntry = (map, playerId, roomId) => {
  if (roomId) return map.get(graceKey(roomId, playerId));
  for (const entry of map.values()) {
    if (entry.playerId === String(playerId)) return entry;
  }
  return undefined;
};

/**
 * Start a grace period for a disconnected player.
 * Emits `playerDisconnected` so other clients can show a badge.
 */
const startGracePeriod = (
  io,
  roomId,
  playerId,
  graceDuration = GRACE_PERIOD,
) => {
  const key = graceKey(roomId, playerId);
  if (gracePeriods.has(key)) return;

  const entry = { roomId, playerId: String(playerId), timerId: null };
  // The task re-checks it is still the live entry, so an expiry already queued
  // behind a rejoin can't kill the player who just came back.
  entry.timerId = scheduleRoomTask(
    roomId,
    graceDuration * 1000,
    async () => {
      if (gracePeriods.get(key) !== entry) return;
      await handleGracePeriodExpiry(io, roomId, playerId);
    },
    "grace expiry",
  );
  gracePeriods.set(key, entry);

  io.to(roomId).emit("playerDisconnected", { playerId });
  console.log(
    `[Disconnect] Grace period started for ${playerId} in room ${roomId}`,
  );
};

/**
 * Cancel the grace period when a player reconnects.
 * Emits `playerReconnected` so clients can remove the badge.
 */
const cancelGracePeriod = (io, roomId, playerId) => {
  const key = graceKey(roomId, playerId);
  const entry = gracePeriods.get(key);
  if (!entry) return;

  clearTimeout(entry.timerId);
  gracePeriods.delete(key);

  io.to(roomId).emit("playerReconnected", { playerId });
  console.log(
    `[Disconnect] Grace period canceled for ${playerId} in room ${roomId}`,
  );
};

/**
 * Resolve the current phase if a death/removal made everyone remaining done.
 * Must run under the room lock.
 */
const resolvePhaseIfReady = async (io, room) => {
  const roomId = room.roomId;
  const alivePlayers = room.players.filter((p) => p.status === "alive");
  if (alivePlayers.length === 0) return;

  const allDone = alivePlayers.every((p) => p.playStatus === "done");

  if (room.gamePhase === "voting") {
    if (allDone) {
      const { claculateVoteResult } = require("./claculateVoteResult.game");
      await claculateVoteResult(io, roomId);
    }
  } else if (room.gamePhase === "night") {
    if (allDone) {
      const { claculateResult } = require("./calculate.game");
      await claculateResult(io, roomId);
    }
  } else if (room.gamePhase === "discussion") {
    const { maybeEndDiscussion } = require("./skipDiscussion.game");
    await maybeEndDiscussion(io, room);
  }
};

/**
 * Grace period expired (or the player left on purpose): mark them dead + done,
 * then resolve the current phase if nobody else is pending. Runs under the
 * room lock.
 */
const handleGracePeriodExpiry = async (io, roomId, playerId) => {
  gracePeriods.delete(graceKey(roomId, playerId));

  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room || room.status !== "playing") return;

    // During gameOver/rematch, don't mark players dead or resolve phases
    if (room.gamePhase === "gameOver" || room.gamePhase === "rematch") return;

    const player = findPlayer(room, playerId);
    if (!player || player.status === "dead") return;

    player.status = "dead";
    player.playStatus = "done";
    player.leftMidGame = true;
    const { removePlayerSkipVote } = require("./skipDiscussion.game");
    removePlayerSkipVote(room, playerId);
    await room.save();

    io.to(roomId).emit("playerDisconnectDeath", { playerId, room });

    console.log(
      `[Disconnect] Grace period expired for ${playerId} — marked dead`,
    );

    await resolvePhaseIfReady(io, room);
  } catch (error) {
    console.error("[Disconnect] Error handling grace period expiry:", error);
  }
};

const isPlayerInGracePeriod = (playerId, roomId) =>
  !!findEntry(gracePeriods, playerId, roomId);

/**
 * Clear all grace period timers for a given room (e.g. when the room ends).
 */
const clearAllGracePeriodsForRoom = (roomId) => {
  for (const map of [gracePeriods, waitingGracePeriods]) {
    for (const [key, entry] of map.entries()) {
      if (entry.roomId === roomId) {
        clearTimeout(entry.timerId);
        map.delete(key);
      }
    }
  }
};

// ---- Waiting-room grace period (lobby disconnect) ----

const WAITING_GRACE_PERIOD = 45; // seconds

const startWaitingGracePeriod = (
  io,
  roomId,
  playerId,
  duration = WAITING_GRACE_PERIOD,
) => {
  const key = graceKey(roomId, playerId);
  if (waitingGracePeriods.has(key)) return;

  const entry = { roomId, playerId: String(playerId), timerId: null };
  entry.timerId = scheduleRoomTask(
    roomId,
    duration * 1000,
    async () => {
      if (waitingGracePeriods.get(key) !== entry) return;
      await handleWaitingGracePeriodExpiry(io, roomId, playerId);
    },
    "waiting grace expiry",
  );
  waitingGracePeriods.set(key, entry);
  console.log(
    `[Disconnect] Waiting grace period started for ${playerId} in room ${roomId}`,
  );
};

const cancelWaitingGracePeriod = (roomId, playerId) => {
  const key = graceKey(roomId, playerId);
  const entry = waitingGracePeriods.get(key);
  if (!entry) return;

  clearTimeout(entry.timerId);
  waitingGracePeriods.delete(key);
  console.log(
    `[Disconnect] Waiting grace period canceled for ${playerId} in room ${roomId}`,
  );
};

const isPlayerInWaitingGracePeriod = (playerId, roomId) =>
  !!findEntry(waitingGracePeriods, playerId, roomId);

const handleWaitingGracePeriodExpiry = async (io, roomId, playerId) => {
  waitingGracePeriods.delete(graceKey(roomId, playerId));

  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room || room.status !== "waiting") return;

    // Quick play rooms: no host concept, just remove the player
    if (room.isQuickPlay) {
      room.players = room.players.filter((p) => pidOf(p) !== String(playerId));

      if (room.players.length === 0) {
        clearAllGracePeriodsForRoom(roomId);
        room.status = "ended";
        const {
          clearActiveQuickPlayRoomId,
          cancelQuickPlayCountdown,
        } = require("./quickPlay.game");
        clearActiveQuickPlayRoomId(roomId);
        cancelQuickPlayCountdown(io, roomId);
        await room.save();
      } else {
        await room.save();
        io.to(roomId).emit("playerLeft", room);
        const { evaluateCountdown } = require("./quickPlay.game");
        await evaluateCountdown(io, roomId);
      }

      broadcastRoomsUpdate(io);
      console.log(
        `[Disconnect] Quick play waiting grace expired for ${playerId} — removed from room ${roomId}`,
      );
      return;
    }

    const wasHost = room.host === String(playerId);

    if (wasHost) {
      // Host's grace period expired — end the room and kick everyone
      clearAllGracePeriodsForRoom(roomId);
      const { cancelTimer } = require("../game/timer.game");
      cancelTimer(roomId);
      room.status = "ended";
      await room.save();
      io.to(roomId).emit("roomClosed");
      broadcastRoomsUpdate(io);
      console.log(
        `[Disconnect] Host ${playerId} grace period expired — room ${roomId} closed`,
      );
      return;
    }

    // Non-host player: remove them from the room
    room.players = room.players.filter((p) => pidOf(p) !== String(playerId));

    if (room.players.length === 0) {
      clearAllGracePeriodsForRoom(roomId);
      const { cancelTimer } = require("../game/timer.game");
      cancelTimer(roomId);
      room.status = "ended";
      await room.save();
    } else {
      await room.save();
      io.to(roomId).emit("playerLeft", room);
    }

    broadcastRoomsUpdate(io);
    console.log(
      `[Disconnect] Waiting grace period expired for ${playerId} — removed from room ${roomId}`,
    );
  } catch (error) {
    console.error(
      "[Disconnect] Error handling waiting grace period expiry:",
      error,
    );
  }
};

// ---- Periodic sweep for orphaned grace timers ----

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let sweepIntervalId = null;

// Drop entries whose room no longer matches the state their timer assumes.
// Catches leaks from code paths that end rooms without calling
// clearAllGracePeriodsForRoom (e.g. the stale-room cleanup in socket.io.js).
const sweepStaleGraceTimers = async () => {
  try {
    const referencedRoomIds = new Set();
    for (const { roomId } of gracePeriods.values()) referencedRoomIds.add(roomId);
    for (const { roomId } of waitingGracePeriods.values())
      referencedRoomIds.add(roomId);

    if (referencedRoomIds.size === 0) return;

    const rooms = await Room.find(
      { roomId: { $in: [...referencedRoomIds] } },
      { roomId: 1, status: 1 },
    ).lean();

    const statusByRoomId = new Map(rooms.map((r) => [r.roomId, r.status]));

    let removed = 0;

    for (const [key, entry] of gracePeriods.entries()) {
      if (statusByRoomId.get(entry.roomId) !== "playing") {
        clearTimeout(entry.timerId);
        gracePeriods.delete(key);
        removed++;
      }
    }

    for (const [key, entry] of waitingGracePeriods.entries()) {
      if (statusByRoomId.get(entry.roomId) !== "waiting") {
        clearTimeout(entry.timerId);
        waitingGracePeriods.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(
        `[Disconnect] Sweep removed ${removed} orphaned grace timer(s)`,
      );
    }
  } catch (error) {
    console.error("[Disconnect] Grace sweep error:", error);
  }
};

const startGraceSweep = (intervalMs = SWEEP_INTERVAL_MS) => {
  if (sweepIntervalId) return sweepIntervalId;
  sweepIntervalId = setInterval(sweepStaleGraceTimers, intervalMs);
  if (typeof sweepIntervalId.unref === "function") sweepIntervalId.unref();
  return sweepIntervalId;
};

const stopGraceSweep = () => {
  if (sweepIntervalId) {
    clearInterval(sweepIntervalId);
    sweepIntervalId = null;
  }
};

module.exports = {
  startGracePeriod,
  cancelGracePeriod,
  handleGracePeriodExpiry,
  resolvePhaseIfReady,
  isPlayerInGracePeriod,
  clearAllGracePeriodsForRoom,
  startWaitingGracePeriod,
  cancelWaitingGracePeriod,
  isPlayerInWaitingGracePeriod,
  startGraceSweep,
  stopGraceSweep,
  sweepStaleGraceTimers,
};
