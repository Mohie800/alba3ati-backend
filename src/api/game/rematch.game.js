const Room = require("../models/room.model");
const { clearSkipVotes } = require("./skipDiscussion.game");
const { clearMutedPlayers } = require("./mutePlayer.game");
const { cancelTimer, startTimer } = require("./timer.game");
const { calculateRandomDistribution } = require("../../utils/randomDistribution");
const { claculateResult } = require("./calculate.game");
const {
  ROUND_TIME,
  QUICK_PLAY_DISCUSSION_TIME,
} = require("../../utils/constants");

const REMATCH_TIMEOUT = 30; // seconds

// In-memory: roomId -> { timerId, tickId, startTime }
const rematchTimers = new Map();

/**
 * Host initiates rematch. Transitions game to "rematch" phase.
 */
const startRematch = async (io, socket, { roomId }) => {
  try {
    if (socket.gameRoomId !== roomId) return;

    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;
    if (room.gamePhase !== "gameOver") return;

    // Prevent race condition: if a rematch timer is already running, someone beat us
    if (rematchTimers.has(roomId)) return;

    // Verify the player is actually in this room
    const inRoom = room.players.some(
      (p) => p.player._id.toString() === socket.playerId
    );
    if (!inRoom) return;

    // Only host can start rematch (in quick play, anyone can)
    if (!room.isQuickPlay && room.host !== socket.playerId) return;

    room.gamePhase = "rematch";
    room.rematchAccepted = [socket.playerId]; // Host auto-accepts
    await room.save();

    io.to(roomId).emit("rematchStarted", {
      room,
      acceptedIds: room.rematchAccepted,
    });

    // Start rematch timeout with countdown ticks
    let remaining = REMATCH_TIMEOUT;
    const tickId = setInterval(() => {
      remaining--;
      io.to(roomId).emit("rematchTick", remaining);
      if (remaining <= 0) {
        clearInterval(tickId);
      }
    }, 1000);

    const timerId = setTimeout(async () => {
      await rematchTimeout(io, roomId);
    }, REMATCH_TIMEOUT * 1000);

    rematchTimers.set(roomId, { timerId, tickId, startTime: Date.now() });
  } catch (error) {
    console.error("[Rematch] Error starting rematch:", error);
  }
};

/**
 * Player accepts rematch.
 */
const acceptRematch = async (io, socket, { roomId }) => {
  try {
    if (socket.gameRoomId !== roomId) return;

    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room || room.gamePhase !== "rematch") return;

    const playerId = socket.playerId;
    if (!playerId) return;

    // Check player is in the room
    const inRoom = room.players.some(
      (p) => p.player._id.toString() === playerId
    );
    if (!inRoom) return;

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
};

/**
 * Get connected player IDs in a socket room.
 */
const getConnectedPlayerIds = (io, roomId) => {
  const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
  const connectedIds = new Set();
  if (socketsInRoom) {
    for (const sid of socketsInRoom) {
      const s = io.sockets.sockets.get(sid);
      if (s?.playerId) connectedIds.add(s.playerId);
    }
  }
  return connectedIds;
};

/**
 * Host begins the new game with accepted players.
 */
const beginRematch = async (io, socket, { roomId }) => {
  try {
    if (socket.gameRoomId !== roomId) return;

    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room || room.gamePhase !== "rematch") return;
    if (!room.isQuickPlay && room.host !== socket.playerId) return;
    // In quick play, only the player who started rematch (first in acceptedIds) can begin
    if (room.isQuickPlay && room.rematchAccepted[0] !== socket.playerId) return;

    const connectedIds = getConnectedPlayerIds(io, roomId);

    // Filter to accepted AND connected players
    const eligibleIds = room.rematchAccepted.filter((id) =>
      connectedIds.has(id)
    );

    if (eligibleIds.length < 2) {
      socket.emit("rematchError", { message: "عدد اللاعبين غير كافي" });
      return;
    }

    clearRematchTimer(roomId);

    // Remove players who didn't accept or aren't connected
    room.players = room.players.filter((p) =>
      eligibleIds.includes(p.player._id.toString())
    );

    resetRoomForRematch(room);

    if (room.isQuickPlay) {
      await autoStartQuickPlayRematch(io, room);
    } else {
      await room.save();
      const updatedRoom = await Room.findOne({ roomId }).populate(
        "players.player"
      );
      io.to(roomId).emit("rematchBegin", { room: updatedRoom });
    }
  } catch (error) {
    console.error("[Rematch] Error beginning rematch:", error);
  }
};

/**
 * Called when rematch timeout expires.
 */
const rematchTimeout = async (io, roomId) => {
  try {
    clearRematchTimer(roomId);

    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room || room.gamePhase !== "rematch") return;

    const connectedIds = getConnectedPlayerIds(io, roomId);
    const eligibleIds = room.rematchAccepted.filter((id) =>
      connectedIds.has(id)
    );

    if (eligibleIds.length >= 2) {
      // Auto-begin with accepted + connected players
      room.players = room.players.filter((p) =>
        eligibleIds.includes(p.player._id.toString())
      );
      resetRoomForRematch(room);

      if (room.isQuickPlay) {
        await autoStartQuickPlayRematch(io, room);
      } else {
        await room.save();
        const updatedRoom = await Room.findOne({ roomId }).populate(
          "players.player"
        );
        io.to(roomId).emit("rematchBegin", { room: updatedRoom });
      }
    } else {
      // Not enough players, close room
      room.status = "ended";
      await room.save();
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
  // Clear in-memory state from previous game
  clearSkipVotes(room.roomId);
  clearMutedPlayers(room.roomId);
  cancelTimer(room.roomId);

  room.status = "playing";
  room.gamePhase = "roleSetup";
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
    console.error("[Rematch] Role pool size mismatch:", rolePool.length, "vs", room.players.length);
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

  room.gamePhase = "night";
  room.discussionTime = QUICK_PLAY_DISCUSSION_TIME;
  room.votesVisible = false;
  room.deadChat = false;
  await room.save();

  startTimer(io, ROUND_TIME, room.roomId, "timerEnd", claculateResult);
  // Emit rematchBegin so excluded players get properly cleaned up
  io.to(room.roomId).emit("rematchBegin", { room });
};

const clearRematchTimer = (roomId) => {
  const entry = rematchTimers.get(roomId);
  if (entry) {
    clearTimeout(entry.timerId);
    clearInterval(entry.tickId);
    rematchTimers.delete(roomId);
  }
};

const getRematchRemainingTime = (roomId) => {
  const entry = rematchTimers.get(roomId);
  if (!entry) return 0;
  const elapsed = Math.floor((Date.now() - entry.startTime) / 1000);
  return Math.max(0, REMATCH_TIMEOUT - elapsed);
};

module.exports = {
  startRematch,
  acceptRematch,
  beginRematch,
  clearRematchTimer,
  getRematchRemainingTime,
};
