const Room = require("../models/room.model");
const {
  calculateRandomDistribution,
} = require("../../utils/randomDistribution");
const { setPhase, startPhaseTimer } = require("./timer.game");
const {
  ROUND_TIME,
  QUICK_PLAY_MIN_PLAYERS,
  QUICK_PLAY_MAX_PLAYERS,
  QUICK_PLAY_COUNTDOWN,
  QUICK_PLAY_DISCUSSION_TIME,
} = require("../../utils/constants");
const {
  isPlayerInWaitingGracePeriod,
  cancelWaitingGracePeriod,
} = require("./disconnect.game");
const { getBlockPartners } = require("../services/friendship.service");
const { withRoomLock, runDetached } = require("./roomLock");
const { PLAYER_POPULATE, pidOf, hasPlayer } = require("./roomUtils");
const { seatSocket, takeOverSeat } = require("./roomMembership");
const { broadcastRoomsUpdate } = require("./roomsList");

// Serializes matchmaking so two simultaneous requests can't each create a
// room (one of them would be orphaned and never fill).
const MATCHMAKING_LOCK = "quickplay:matchmaking";

// In-memory state
let activeQuickPlayRoomId = null;
// Per-room countdown state: roomId -> { timer, remaining }
const countdownState = new Map();

function getRandomString(length = 7) {
  return Math.random()
    .toString(36)
    .substring(2, 2 + length);
}

// Shuffle array (Fisher-Yates)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const emitSeated = async (io, socket, room) => {
  socket.emit("roomJoined", room);
  io.to(room.roomId).emit("playerJoined", room);
  await evaluateCountdown(io, room.roomId);
};

/**
 * Find or create a quick play room and add the player to it.
 */
const findOrCreateQuickPlayRoom = (io, socket, playerId) =>
  withRoomLock(MATCHMAKING_LOCK, () => matchmake(io, socket, String(playerId)));

const matchmake = async (io, socket, playerId, attempt = 0) => {
  try {
    let room = null;

    if (activeQuickPlayRoomId) {
      room = await Room.findOne({ roomId: activeQuickPlayRoomId }).populate(
        PLAYER_POPULATE,
      );

      // If room no longer valid, clear it
      if (!room || room.status !== "waiting") {
        activeQuickPlayRoomId = null;
        room = null;
      }

      // Already seated here (double tap or reconnect): take the seat back.
      if (room && hasPlayer(room, playerId)) {
        const roomId = room.roomId;
        await withRoomLock(roomId, async () => {
          takeOverSeat(io, socket, roomId, playerId);
          if (isPlayerInWaitingGracePeriod(playerId, roomId)) {
            cancelWaitingGracePeriod(roomId, playerId);
          }
          await seatSocket(io, socket, roomId, playerId);
          await emitSeated(io, socket, room);
        });
        return;
      }

      // If room is full, create a new one
      if (room && room.players.length >= QUICK_PLAY_MAX_PLAYERS) {
        activeQuickPlayRoomId = null;
        room = null;
      }

      // Block conflict: skip a room containing anyone the joiner has blocked
      // (or who has blocked the joiner). Falls through to create a new room
      // and replace the active slot so future joiners match the new room.
      // The orphaned room keeps its existing players but won't accept new ones.
      if (room) {
        const partners = await getBlockPartners(playerId);
        if (partners.size > 0) {
          const conflict = room.players.some((p) => partners.has(pidOf(p)));
          if (conflict) {
            activeQuickPlayRoomId = null;
            room = null;
          }
        }
      }
    }

    // Create a new quick play room if needed
    if (!room) {
      const roomId = getRandomString();
      await Room.create({
        roomId,
        host: playerId,
        players: [{ player: playerId }],
        isQuickPlay: true,
      });
      activeQuickPlayRoomId = roomId;

      await withRoomLock(roomId, async () => {
        const created = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
        await seatSocket(io, socket, roomId, playerId);
        await emitSeated(io, socket, created);
      });
      return;
    }

    // Add player to existing room. The filter re-checks state atomically, so
    // a room that just started or filled up is never over-filled.
    const roomId = room.roomId;
    const joined = await withRoomLock(roomId, async () => {
      const updated = await Room.findOneAndUpdate(
        {
          _id: room._id,
          status: "waiting",
          "players.player": { $ne: playerId },
          [`players.${QUICK_PLAY_MAX_PLAYERS - 1}`]: { $exists: false },
        },
        { $push: { players: { player: playerId } } },
        { new: true },
      ).populate(PLAYER_POPULATE);
      if (!updated) return false;

      await seatSocket(io, socket, roomId, playerId);
      await emitSeated(io, socket, updated);
      return true;
    });

    if (!joined) {
      if (activeQuickPlayRoomId === roomId) activeQuickPlayRoomId = null;
      if (attempt < 1) return matchmake(io, socket, playerId, attempt + 1);
      socket.emit("joinError", { message: "Failed to join quick play" });
    }
  } catch (error) {
    console.error("[QuickPlay] Error in findOrCreateQuickPlayRoom:", error);
    socket.emit("joinError", { message: "Failed to join quick play" });
  }
};

/**
 * Evaluate whether to start or cancel the countdown based on player count.
 */
const evaluateCountdown = async (io, roomId) => {
  try {
    const room = await Room.findOne({ roomId }, "status isQuickPlay players");
    if (!room || room.status !== "waiting" || !room.isQuickPlay) return;

    const playerCount = room.players.length;
    const hasCountdown = countdownState.has(roomId);

    if (playerCount >= QUICK_PLAY_MIN_PLAYERS && !hasCountdown) {
      startQuickPlayCountdown(io, roomId);
    } else if (playerCount < QUICK_PLAY_MIN_PLAYERS && hasCountdown) {
      cancelQuickPlayCountdown(io, roomId);
    }
  } catch (error) {
    console.error("[QuickPlay] Error in evaluateCountdown:", error);
  }
};

/**
 * Start the quick play countdown (10 seconds).
 */
const startQuickPlayCountdown = (io, roomId) => {
  if (countdownState.has(roomId)) return;

  let remaining = QUICK_PLAY_COUNTDOWN;
  io.to(roomId).emit("quickPlayCountdownTick", remaining);

  const state = { timer: null, remaining };
  state.timer = runDetached(() =>
    setInterval(() => {
      if (countdownState.get(roomId) !== state) {
        clearInterval(state.timer);
        return;
      }
      remaining--;

      if (remaining <= 0) {
        clearInterval(state.timer);
        countdownState.delete(roomId);
        withRoomLock(roomId, () => autoStartQuickPlayGame(io, roomId)).catch(
          (err) => console.error("[QuickPlay] auto-start failed:", err),
        );
      } else {
        io.to(roomId).emit("quickPlayCountdownTick", remaining);
      }
    }, 1000),
  );

  countdownState.set(roomId, state);
  console.log(`[QuickPlay] Countdown started for room ${roomId}`);
};

/**
 * Cancel the quick play countdown.
 */
const cancelQuickPlayCountdown = (io, roomId) => {
  const state = countdownState.get(roomId);
  if (!state) return;

  clearInterval(state.timer);
  countdownState.delete(roomId);
  io.to(roomId).emit("quickPlayCountdownCanceled");

  console.log(`[QuickPlay] Countdown canceled for room ${roomId}`);
};

/**
 * Auto-start the game when countdown reaches 0. Runs under the room lock.
 */
const autoStartQuickPlayGame = async (io, roomId) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room || room.status !== "waiting") return;
    // Someone may have left while the start was queued.
    if (room.players.length < QUICK_PLAY_MIN_PLAYERS) {
      io.to(roomId).emit("quickPlayCountdownCanceled");
      return;
    }

    // Clear active room so next quick play request creates a new one
    if (activeQuickPlayRoomId === roomId) {
      activeQuickPlayRoomId = null;
    }

    // Calculate random distribution with all optional roles enabled
    const distribution = calculateRandomDistribution(room.players.length, {
      damazeen: true,
      sitAlwada3: true,
      abuJanzeer: true,
      ballah: true,
      ba3atiKabeer: true,
    });

    // Create role pool and assign
    const rolePool = [];
    Object.entries(distribution).forEach(([roleId, count]) => {
      rolePool.push(...Array(count).fill(roleId));
    });

    const shuffledPlayers = shuffleArray([...room.players]);
    shuffledPlayers.forEach((player, index) => {
      player.roleId = rolePool[index];
    });

    // Update room state
    room.status = "playing";
    setPhase(room, "night", ROUND_TIME);
    room.discussionTime = QUICK_PLAY_DISCUSSION_TIME;
    room.votesVisible = false;
    room.deadChat = false;
    await room.save();

    // Start night timer
    startPhaseTimer(io, room);

    // Notify players (same event as normal role assignment)
    io.to(roomId).emit("rolesAssigned", { room });

    broadcastRoomsUpdate(io);

    console.log(
      `[QuickPlay] Game auto-started in room ${roomId} with ${room.players.length} players`,
    );
  } catch (error) {
    console.error("[QuickPlay] Error in autoStartQuickPlayGame:", error);
  }
};

/**
 * Handle a player leaving during quick play waiting.
 */
const handleQuickPlayLeave = (io, roomId, playerId) =>
  withRoomLock(roomId, async () => {
    try {
      const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
      if (!room) return;

      room.players = room.players.filter((p) => pidOf(p) !== String(playerId));

      if (room.players.length === 0) {
        room.status = "ended";
        room.activePlayers = 0;
        if (activeQuickPlayRoomId === roomId) {
          activeQuickPlayRoomId = null;
        }
        cancelQuickPlayCountdown(io, roomId);
        await room.save();
        return;
      }

      await room.save();
      io.to(roomId).emit("playerLeft", room);
      await evaluateCountdown(io, roomId);
    } catch (error) {
      console.error("[QuickPlay] Error in handleQuickPlayLeave:", error);
    }
  });

const getActiveQuickPlayRoomId = () => activeQuickPlayRoomId;

// After a restart: point matchmaking back at the newest open lobby.
const restoreActiveQuickPlayRoom = async () => {
  const room = await Room.findOne(
    {
      isQuickPlay: true,
      status: "waiting",
      [`players.${QUICK_PLAY_MAX_PLAYERS - 1}`]: { $exists: false },
    },
    "roomId",
  )
    .sort({ createdAt: -1 })
    .lean();
  activeQuickPlayRoomId = room ? room.roomId : null;
};

const clearActiveQuickPlayRoomId = (roomId) => {
  if (activeQuickPlayRoomId === roomId) {
    activeQuickPlayRoomId = null;
  }
};

module.exports = {
  findOrCreateQuickPlayRoom,
  evaluateCountdown,
  handleQuickPlayLeave,
  cancelQuickPlayCountdown,
  getActiveQuickPlayRoomId,
  clearActiveQuickPlayRoomId,
  restoreActiveQuickPlayRoom,
};
