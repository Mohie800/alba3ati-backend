const Room = require("../models/room.model");
const {
  startGracePeriod,
  cancelGracePeriod,
  handleGracePeriodExpiry,
  clearAllGracePeriodsForRoom,
  startWaitingGracePeriod,
  cancelWaitingGracePeriod,
} = require("../game/disconnect.game");
const { cancelTimer } = require("../game/timer.game");
const { handleQuickPlayLeave } = require("../game/quickPlay.game");
const { QUICK_PLAY_GRACE_PERIOD } = require("../../utils/constants");
const { clearRematchTimer } = require("../game/rematch.game");
const { withRoomLock } = require("../game/roomLock");
const { PLAYER_POPULATE, pidOf } = require("../game/roomUtils");
const { getActiveRooms, broadcastRoomsUpdate } = require("../game/roomsList");
const {
  getPlayerSocketCount,
  getPlayerSockets,
  unseatSocket,
} = require("../game/roomMembership");

const setActivePlayers = (roomId, count) =>
  Room.updateOne({ roomId }, { $set: { activePlayers: count } });

const leaveSpectator = (io, socket, roomId, userId) => {
  socket.leave(roomId);
  if (!userId) return Promise.resolve();
  return withRoomLock(roomId, async () => {
    try {
      const updated = await Room.findOneAndUpdate(
        { roomId },
        { $pull: { spectators: { user: userId } } },
        { new: true },
      );
      if (updated) {
        io.to(roomId).emit("spectatorCountChanged", {
          roomId,
          count: updated.spectators.length,
        });
      }
    } catch (err) {
      console.error("[leaveSpectator] error:", err);
    }
  });
};

const endRoom = async (io, room, { notify = true } = {}) => {
  const roomId = room.roomId;
  clearRematchTimer(roomId);
  clearAllGracePeriodsForRoom(roomId);
  cancelTimer(roomId);
  room.status = "ended";
  room.activePlayers = 0;
  await room.save();
  if (notify) io.to(roomId).emit("roomClosed");
  broadcastRoomsUpdate(io);
};

// All leave paths for a player, serialized per room.
const leaveRoom = (io, socket, roomId, playerId, intentional = false) => {
  socket.leave(roomId);
  return withRoomLock(roomId, () =>
    leaveRoomLocked(io, roomId, playerId ? String(playerId) : null, intentional),
  );
};

const leaveRoomLocked = async (io, roomId, playerId, intentional) => {
  const count = getPlayerSocketCount(io, roomId);

  // Still connected on another socket: a dropped duplicate isn't a leave.
  if (!intentional && playerId && getPlayerSockets(io, roomId, playerId).length) {
    await setActivePlayers(roomId, count);
    return;
  }

  const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
  if (!room || room.status === "ended") return;

  if (room.status === "waiting") {
    // Quick play rooms: no host privileges
    if (room.isQuickPlay) {
      if (playerId && intentional) {
        await handleQuickPlayLeave(io, roomId, playerId);
      } else if (playerId) {
        startWaitingGracePeriod(io, roomId, playerId, QUICK_PLAY_GRACE_PERIOD);
        await setActivePlayers(roomId, count);
      }
      return;
    }

    if (playerId && !intentional) {
      // Unintentional disconnect: give the player time to reconnect
      startWaitingGracePeriod(io, roomId, playerId);
      await setActivePlayers(roomId, count);
      if (room.isPublic) broadcastRoomsUpdate(io);
      return;
    }

    if (playerId) {
      // If the host leaves, end the room and kick everyone
      if (room.host === playerId) {
        await endRoom(io, room);
        return;
      }
      room.players = room.players.filter((p) => pidOf(p) !== playerId);
    }
  } else if (room.status === "playing" && playerId) {
    const isPostGame =
      room.gamePhase === "gameOver" || room.gamePhase === "rematch";

    if (intentional && isPostGame) {
      // Host leaving during gameOver/rematch closes the room (non-quick-play only)
      if (room.host === playerId && !room.isQuickPlay) {
        await endRoom(io, room);
        return;
      }
      // Non-host (or quick play host): they'll be excluded from the rematch
      // since they won't be connected.
    } else if (intentional) {
      // Intentional mid-game leave (player went home): no reconnect window.
      cancelGracePeriod(io, roomId, playerId);
      await setActivePlayers(roomId, count);
      await handleGracePeriodExpiry(io, roomId, playerId);
      return;
    } else {
      // Unintentional disconnect: give the player a window to reconnect.
      const graceDuration = room.isQuickPlay ? QUICK_PLAY_GRACE_PERIOD : undefined;
      startGracePeriod(io, roomId, playerId, graceDuration);
    }
  }

  room.activePlayers = count;

  // An empty room ends right away only when people left on purpose (or the
  // game is over). Mid-game disconnects keep it alive for the grace period;
  // the stale-room sweep ends it if nobody comes back.
  const isPostGame = room.gamePhase === "gameOver" || room.gamePhase === "rematch";
  if (count === 0 && (intentional || isPostGame || room.status === "waiting")) {
    await endRoom(io, room, { notify: false });
    return;
  }

  await room.save();
  // Notify remaining players so their UI updates
  io.to(roomId).emit("playerLeft", room);
  if (room.status === "waiting" && room.isPublic) broadcastRoomsUpdate(io);
};

// Account deletion: take the user out of every active room first, while their
// User doc still exists (afterwards populate yields null and they can't be
// matched). Same outcome as leaving on purpose.
const removeUserFromActiveRooms = async (io, userId) => {
  const id = String(userId);
  const rooms = await Room.find(
    { status: { $in: ["waiting", "playing"] }, "players.player": id },
    "roomId",
  ).lean();
  for (const { roomId } of rooms) {
    try {
      await withRoomLock(roomId, async () => {
        if (io) {
          for (const s of getPlayerSockets(io, roomId, id)) unseatSocket(s);
        }
        await leaveRoomLocked(io, roomId, id, true);
      });
    } catch (err) {
      console.error(`[removeUserFromActiveRooms] ${roomId}:`, err);
    }
  }
};

const publicRoom = (io, socket, { roomId, isPublic } = {}) => {
  if (!roomId) return;
  return withRoomLock(roomId, async () => {
    try {
      const room = await Room.findOneAndUpdate(
        { roomId },
        { isPublic: !isPublic },
        { new: true },
      ).populate(PLAYER_POPULATE);
      if (!room) {
        return socket.emit("roomNotFound", { message: "Room not found" });
      }
      socket.emit("roomUpdated", room);
      broadcastRoomsUpdate(io);
    } catch (error) {
      console.error("Error updating room status:", error);
    }
  });
};

module.exports = {
  getActiveRooms,
  leaveRoom,
  publicRoom,
  leaveSpectator,
  removeUserFromActiveRooms,
  getPlayerSocketCount,
};
