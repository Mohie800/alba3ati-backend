const Room = require("../models/room.model");
const {
  cancelTimer,
  setPhase,
  startPhaseTimer,
  getRemainingTime,
  getTimerPhase,
} = require("./timer.game");
const { withRoomLock } = require("./roomLock");
const { PLAYER_POPULATE, pidOf, hasPlayer } = require("./roomUtils");
const { seatSocket } = require("./roomMembership");
const { clearAllGracePeriodsForRoom } = require("./disconnect.game");
const {
  calculateRandomDistribution,
} = require("../../utils/randomDistribution");
const {
  ROUND_TIME,
  QUICK_PLAY_DISCUSSION_TIME,
  QUICK_PLAY_MIN_PLAYERS,
  MAX_ROOM_PLAYERS,
  REMATCH_TIME,
} = require("../../utils/constants");

// Dev account that can start games below the minimum (mirrors startGame).
const DEV_HOST_ID = "69c9ab1a6631e3885a13ed49";

/**
 * Whether `count` players is enough to (re)start a game in this room.
 * Mirrors the guards used on a fresh start: quick play needs
 * QUICK_PLAY_MIN_PLAYERS, regular rooms need >4 (the dev host can bypass).
 */
const hasEnoughPlayers = (room, count) => {
  if (room.isQuickPlay) return count >= QUICK_PLAY_MIN_PLAYERS;
  if (room.host?.toString() === DEV_HOST_ID) return true;
  return count > 4;
};

const lockedByRoom = (fn) => (io, socket, arg) => {
  const roomId = arg && arg.roomId;
  if (!roomId) return;
  return withRoomLock(roomId, () => fn(io, socket, arg));
};

/**
 * Host initiates rematch. Transitions game to "rematch" phase.
 */
const startRematch = lockedByRoom(async (io, socket, { roomId }) => {
  try {
    if (socket.gameRoomId !== roomId) return;

    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room || room.status !== "playing") return;
    // Under the room lock a second start (two players tapping at once) sees
    // "rematch" here and stops, so only one countdown can ever exist.
    if (room.gamePhase !== "gameOver") return;

    // Verify the player is actually in this room
    if (!hasPlayer(room, socket.playerId)) return;

    // Only host can start rematch (in quick play, anyone can)
    if (!room.isQuickPlay && room.host !== socket.playerId) return;

    setPhase(room, "rematch", REMATCH_TIME);
    room.rematchAccepted = [socket.playerId]; // Host auto-accepts
    await room.save();

    io.to(roomId).emit("rematchStarted", {
      room,
      acceptedIds: room.rematchAccepted,
    });

    // The phase timer runs rematchTimeout at the deadline (also after a restart).
    startPhaseTimer(io, room);
  } catch (error) {
    console.error("[Rematch] Error starting rematch:", error);
  }
});

/**
 * Player accepts rematch.
 */
const acceptRematch = lockedByRoom(async (io, socket, { roomId }) => {
  try {
    if (socket.gameRoomId !== roomId) return;

    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room || room.gamePhase !== "rematch") return;

    const playerId = socket.playerId;
    if (!playerId) return;

    if (!hasPlayer(room, playerId)) return;

    // Idempotent
    if (room.rematchAccepted.includes(playerId)) return;

    room.rematchAccepted.push(playerId);
    await room.save();

    io.to(roomId).emit("rematchUpdate", {
      acceptedIds: room.rematchAccepted,
      room,
    });
  } catch (error) {
    console.error("[Rematch] Error accepting rematch:", error);
  }
});

/**
 * Spectator opts into the rematch and becomes a player.
 *
 * Converts the caller from a spectator (lives in `room.spectators`, listen-only)
 * into a real player (in `room.players`) who auto-accepts the rematch. Once in
 * `room.players` + `rematchAccepted` with a live socket, the existing
 * begin/timeout logic includes them with no further changes.
 *
 * Returns the joined userId on success, otherwise undefined.
 */
const joinRematch = lockedByRoom(async (io, socket, { roomId }) => {
  try {
    if (socket.gameRoomId !== roomId) return;

    const userId = socket.playerId; // spectators have playerId set
    if (!userId || !socket.isSpectator) return;

    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room || room.gamePhase !== "rematch") return;

    // Already a player? nothing to do.
    if (hasPlayer(room, userId)) return;

    // Capacity guard — mirrors the joinRoom cap (socket.io.js).
    if (room.players.length >= MAX_ROOM_PLAYERS) {
      socket.emit("rematchError", { message: "الغرفة ممتلئة" });
      return;
    }

    // Convert: pull from spectators, push to players, auto-accept.
    room.spectators = room.spectators.filter(
      (s) => s.user?.toString() !== userId,
    );
    room.players.push({ player: userId });
    if (!room.rematchAccepted.includes(userId)) {
      room.rematchAccepted.push(userId);
    }
    await room.save();

    // Out of read-only spectator mode; also counted in activePlayers/presence.
    await seatSocket(io, socket, roomId, userId);

    const updated = await room.populate(PLAYER_POPULATE);

    // Everyone refreshes the player list + accepted list + spectator count.
    io.to(roomId).emit("rematchUpdate", {
      acceptedIds: updated.rematchAccepted,
      room: updated,
    });
    io.to(roomId).emit("spectatorCountChanged", {
      roomId,
      count: updated.spectators?.length || 0,
    });

    // Tell the joiner specifically to flip out of spectator mode (the client
    // uses this to re-request a LiveKit token with publish rights).
    socket.emit("rematchJoined", { room: updated });

    return userId;
  } catch (error) {
    console.error("[Rematch] Error joining rematch:", error);
  }
});

/**
 * Get connected (non-spectator) player IDs in a socket room.
 */
const getConnectedPlayerIds = (io, roomId) => {
  const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
  const connectedIds = new Set();
  if (socketsInRoom) {
    for (const sid of socketsInRoom) {
      const s = io.sockets.sockets.get(sid);
      if (s?.playerId && !s.isSpectator) connectedIds.add(s.playerId);
    }
  }
  return connectedIds;
};

/**
 * Host begins the new game with accepted players.
 */
const beginRematch = lockedByRoom(async (io, socket, { roomId }) => {
  try {
    if (socket.gameRoomId !== roomId) return;

    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room || room.status !== "playing" || room.gamePhase !== "rematch") return;
    if (!room.isQuickPlay && room.host !== socket.playerId) return;
    // In quick play, only the player who started rematch (first in acceptedIds) can begin
    if (room.isQuickPlay && room.rematchAccepted[0] !== socket.playerId) return;

    const connectedIds = getConnectedPlayerIds(io, roomId);

    // Filter to accepted AND connected players
    const eligibleIds = room.rematchAccepted.filter((id) =>
      connectedIds.has(id),
    );

    if (!hasEnoughPlayers(room, eligibleIds.length)) {
      socket.emit("rematchError", { message: "عدد اللاعبين غير كافي" });
      return;
    }

    await launchRematch(io, room, eligibleIds);
  } catch (error) {
    console.error("[Rematch] Error beginning rematch:", error);
  }
});

// Starts the next game with `eligibleIds`. The rematch timer is cleared only
// after the new state is saved, so a failed save can't strand the room.
const launchRematch = async (io, room, eligibleIds) => {
  const roomId = room.roomId;
  room.players = room.players.filter((p) => eligibleIds.includes(pidOf(p)));
  resetRoomForRematch(room);

  if (room.isQuickPlay) {
    await autoStartQuickPlayRematch(io, room);
  } else {
    await room.save();
    io.to(roomId).emit("rematchBegin", { room });
  }
  clearRematchTimer(roomId);
};

/**
 * Rematch deadline reached. Runs under the room lock (phase timer).
 */
const rematchTimeout = async (io, roomId) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room || room.status !== "playing" || room.gamePhase !== "rematch") {
      clearRematchTimer(roomId);
      return;
    }

    const connectedIds = getConnectedPlayerIds(io, roomId);
    const eligibleIds = room.rematchAccepted.filter((id) =>
      connectedIds.has(id),
    );

    if (hasEnoughPlayers(room, eligibleIds.length)) {
      // Auto-begin with accepted + connected players
      await launchRematch(io, room, eligibleIds);
    } else {
      // Not enough players, close room
      room.status = "ended";
      await room.save();
      clearRematchTimer(roomId);
      clearAllGracePeriodsForRoom(roomId);
      cancelTimer(roomId);
      io.to(roomId).emit("roomClosed", { reason: "rematchTimeout" });
    }
  } catch (error) {
    console.error("[Rematch] Error handling timeout:", error);
  }
};

/**
 * Reset room fields for a new game.
 */
const resetRoomForRematch = (room) => {
  cancelTimer(room.roomId);

  room.status = "playing";
  setPhase(room, "roleSetup");
  room.skipVotes = [];
  room.mutedPlayers = [];
  room.roleDeclarations = new Map();
  room.gameResult = null;
  room.roundNumber = 1;
  room.votes = [];
  room.rematchAccepted = [];

  // Reset player states
  room.players.forEach((p) => {
    p.roleId = null;
    p.status = "alive";
    p.night = 1;
    p.kills = 0;
    p.target = null;
    p.playStatus = "playing";
    p.leftMidGame = false;
  });

  // Reset all action targets
  room.ba3atiTargets = [];
  room.al3omdaTargets = [];
  room.damazeenTargets = [];
  room.damazeenProtection = false;
  room.damazeenAttackUsedBy = [];
  room.damazeenProtectUsedBy = [];
  room.sitAlwada3Targets = [];
  room.abuJanzeerTargets = [];
  room.ballahTargets = [];
  room.ballahAttackUsedBy = [];
  room.ba3atiKabeerTargets = [];
  room.ba3atiKabeerConvertTargets = [];
  room.ba3atiKabeerConvertUsedBy = [];
  room.jenabuTargets = [];
  room.wadAlzalatTargets = [];
  room.wadAlzalatUsedBy = [];
  room.lastAl3omdaTargets = new Map();
};

/**
 * For quick play rematch: auto-assign roles and start night phase.
 */
const autoStartQuickPlayRematch = async (io, room) => {
  const distribution = calculateRandomDistribution(room.players.length, {
    damazeen: true,
    sitAlwada3: true,
    abuJanzeer: true,
    ballah: true,
    ba3atiKabeer: true,
  });

  const rolePool = [];
  Object.entries(distribution).forEach(([roleId, count]) => {
    rolePool.push(...Array(count).fill(roleId));
  });

  if (rolePool.length < room.players.length) {
    console.error(
      "[Rematch] Role pool size mismatch:",
      rolePool.length,
      "vs",
      room.players.length,
    );
    return;
  }

  // Fisher-Yates shuffle for uniform distribution
  const players = [...room.players];
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }
  players.forEach((player, index) => {
    player.roleId = rolePool[index];
  });

  setPhase(room, "night", ROUND_TIME);
  room.discussionTime = QUICK_PLAY_DISCUSSION_TIME;
  room.votesVisible = false;
  room.deadChat = false;
  await room.save();

  startPhaseTimer(io, room);
  // Emit rematchBegin so excluded players get properly cleaned up
  io.to(room.roomId).emit("rematchBegin", { room });
};

const clearRematchTimer = (roomId) => {
  if (getTimerPhase(roomId) === "rematch") cancelTimer(roomId);
};

const getRematchRemainingTime = (roomId) =>
  getTimerPhase(roomId) === "rematch" ? getRemainingTime(roomId) : 0;

module.exports = {
  startRematch,
  acceptRematch,
  joinRematch,
  beginRematch,
  clearRematchTimer,
  getRematchRemainingTime,
  rematchTimeout,
};
