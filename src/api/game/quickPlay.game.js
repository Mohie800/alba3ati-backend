const Room = require("../models/room.model");
const { joinRoom, getActiveRooms } = require("../controllers/room.controller");
const { calculateRandomDistribution } = require("../../utils/randomDistribution");
const { startTimer } = require("./timer.game");
const { claculateResult } = require("./calculate.game");
const {
  ROUND_TIME,
  QUICK_PLAY_MIN_PLAYERS,
  QUICK_PLAY_MAX_PLAYERS,
  QUICK_PLAY_COUNTDOWN,
  QUICK_PLAY_DISCUSSION_TIME,
} = require("../../utils/constants");

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

/**
 * Find or create a quick play room and add the player to it.
 */
const findOrCreateQuickPlayRoom = async (io, socket, playerId) => {
  try {
    let room = null;

    // Try to use the active quick play room
    if (activeQuickPlayRoomId) {
      room = await Room.findOne({ roomId: activeQuickPlayRoomId }).populate(
        "players.player"
      );

      // If room no longer valid, clear it
      if (!room || room.status !== "waiting") {
        activeQuickPlayRoomId = null;
        room = null;
      }

      // Check if player is already in this room (reconnect)
      if (room) {
        const alreadyInRoom = room.players.some(
          (p) => p.player._id.toString() === playerId
        );
        if (alreadyInRoom) {
          // Rejoin socket room
          joinRoom(io, socket, room.roomId);
          socket.gameRoomId = room.roomId;
          socket.playerId = playerId;
          socket.emit("roomJoined", room);
          io.to(room.roomId).emit("playerJoined", room);
          return;
        }
      }

      // If room is full, create a new one
      if (room && room.players.length >= QUICK_PLAY_MAX_PLAYERS) {
        activeQuickPlayRoomId = null;
        room = null;
      }
    }

    // Create a new quick play room if needed
    if (!room) {
      const roomId = getRandomString();
      room = await Room.create({
        roomId,
        host: playerId,
        players: [{ player: playerId }],
        isQuickPlay: true,
      });
      activeQuickPlayRoomId = roomId;

      room = await Room.findOne({ roomId }).populate("players.player");
      joinRoom(io, socket, roomId);
      socket.gameRoomId = roomId;
      socket.playerId = playerId;
      socket.emit("roomJoined", room);
      io.to(roomId).emit("playerJoined", room);
      evaluateCountdown(io, roomId);
      return;
    }

    // Add player to existing room
    room = await Room.findByIdAndUpdate(
      room._id,
      { $push: { players: { player: playerId } } },
      { new: true }
    ).populate("players.player");

    joinRoom(io, socket, room.roomId);
    socket.gameRoomId = room.roomId;
    socket.playerId = playerId;
    socket.emit("roomJoined", room);
    io.to(room.roomId).emit("playerJoined", room);
    evaluateCountdown(io, room.roomId);
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
    const room = await Room.findOne({ roomId }).populate("players.player");
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

  const timer = setInterval(async () => {
    remaining--;

    if (remaining <= 0) {
      clearInterval(timer);
      countdownState.delete(roomId);
      await autoStartQuickPlayGame(io, roomId);
    } else {
      io.to(roomId).emit("quickPlayCountdownTick", remaining);
    }
  }, 1000);

  countdownState.set(roomId, { timer, remaining });
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
 * Auto-start the game when countdown reaches 0.
 */
const autoStartQuickPlayGame = async (io, roomId) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room || room.status !== "waiting") return;

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
    room.gamePhase = "night";
    room.discussionTime = QUICK_PLAY_DISCUSSION_TIME;
    room.votesVisible = false;
    room.deadChat = false;
    await room.save();

    // Start night timer
    startTimer(io, ROUND_TIME, roomId, "timerEnd", claculateResult);

    // Notify players (same event as normal role assignment)
    io.to(roomId).emit("rolesAssigned", { room });

    // Update public rooms list
    const rooms = await getActiveRooms();
    io.emit("roomsUpdate", rooms);

    console.log(
      `[QuickPlay] Game auto-started in room ${roomId} with ${room.players.length} players`
    );
  } catch (error) {
    console.error("[QuickPlay] Error in autoStartQuickPlayGame:", error);
  }
};

/**
 * Handle a player leaving during quick play waiting.
 */
const handleQuickPlayLeave = async (io, roomId, playerId) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    room.players = room.players.filter(
      (p) => p.player._id.toString() !== playerId
    );

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
    evaluateCountdown(io, roomId);
  } catch (error) {
    console.error("[QuickPlay] Error in handleQuickPlayLeave:", error);
  }
};

const getActiveQuickPlayRoomId = () => activeQuickPlayRoomId;

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
};
