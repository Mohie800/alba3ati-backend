const SocketIO = require("socket.io");
const config = require("../config/config");

const Room = require("../api/models/room.model");
const User = require("../api/models/user.model");
const BannedDevice = require("../api/models/bannedDevice.model");
const {
  sendPushNotification,
} = require("../api/services/pushNotification.service");
const presenceService = require("../api/services/presence.service");
const friendshipService = require("../api/services/friendship.service");
const { getBlockPartners } = require("../api/services/friendship.service");
const { assignRoles } = require("../api/game/roles.game");
const {
  ba3atiAction,
  al3omdaAction,
  startGame,
  damazeenAction,
  damazeenProtection,
  sitAlwada3Action,
  abuJanzeerAction,
  ballahAction,
  skipNightAction,
  ba3atiKabeerAction,
  ba3atiKabeerConvert,
  jenabuAction,
  wadAlzalatAction,
} = require("../api/game/room.actions");
const { voteSubmit, voteSkip } = require("../api/game/votes.game");
const {
  skipDiscussionVote,
  getSkipState,
} = require("../api/game/skipDiscussion.game");
const {
  mutePlayerToggle,
  getMutedPlayers,
} = require("../api/game/mutePlayer.game");
const {
  handleDeclareRole,
  getRoleDeclarations,
} = require("../api/game/declareRole.game");
const { getRemainingTime, timerPayload } = require("../api/game/timer.game");
const {
  leaveRoom,
  publicRoom,
  leaveSpectator,
} = require("../api/controllers/room.controller");
const {
  MAX_SPECTATORS,
  MAX_ROOM_PLAYERS,
  MAINTENANCE_BYPASS_USER_IDS,
} = require("../utils/constants");
const {
  cancelGracePeriod,
  isPlayerInGracePeriod,
  cancelWaitingGracePeriod,
  isPlayerInWaitingGracePeriod,
  startGraceSweep,
} = require("../api/game/disconnect.game");
const initChat = require("../api/services/chat.service");
const AppSettings = require("../api/models/appSettings.model");
const {
  findOrCreateQuickPlayRoom,
  evaluateCountdown,
  getActiveQuickPlayRoomId,
} = require("../api/game/quickPlay.game");
const {
  startRematch,
  acceptRematch,
  joinRematch,
  beginRematch,
  getRematchRemainingTime,
} = require("../api/game/rematch.game");
const {
  updatePeakConcurrent,
  sampleConcurrency,
} = require("../api/game/dailyStats.game");
const { withRoomLock } = require("../api/game/roomLock");
const { PLAYER_POPULATE, pidOf, findPlayer } = require("../api/game/roomUtils");
const { broadcastRoomsUpdate } = require("../api/game/roomsList");
const { seatSocket, takeOverSeat } = require("../api/game/roomMembership");

function isMaintenanceActive(appSettings, userId) {
  if (!appSettings.maintenanceMode) return false;
  return !MAINTENANCE_BYPASS_USER_IDS.has(String(userId || ""));
}

module.exports = (server) => {
  const io = SocketIO(server, {
    cors: {
      origin: config.env === "production" ? "PRODUCTION_URL" : "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
    perMessageDeflate: {
      threshold: 1024,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Ban middleware — rejects connections from banned devices before any handlers run
  io.use(async (socket, next) => {
    const { deviceId } = socket.handshake.auth;
    if (!deviceId) return next();

    try {
      const normalizedId = deviceId.trim().toLowerCase();
      const banned = await BannedDevice.findOne({ deviceId: normalizedId });

      if (!banned) return next();

      if (banned.expiresAt && banned.expiresAt < new Date()) {
        await BannedDevice.deleteOne({ _id: banned._id });
        return next();
      }

      const err = new Error("DEVICE_BANNED");
      err.data = { reason: banned.reason, expiresAt: banned.expiresAt };
      next(err);
    } catch {
      next(); // fail open on DB error to avoid locking out all users
    }
  });

  function getRandomString(length = 7) {
    return Math.random()
      .toString(36)
      .substring(2, 2 + length);
  }

  function emitToUser(userId, event, data) {
    for (const socketId of presenceService.getSocketIds(userId)) {
      io.to(socketId).emit(event, data);
    }
  }

  // Inject emitToUser into friendship service so it can emit events on request/accept/etc.
  friendshipService.setEmitToUser(emitToUser);

  /**
   * Broadcast a presence change to the player's online friends.
   */
  async function notifyFriendsPresence(userId, presence) {
    try {
      const friendIds = await friendshipService.getFriendIds(userId);
      for (const friendId of friendIds) {
        if (presenceService.isOnline(friendId)) {
          emitToUser(friendId, "friendPresenceUpdate", { userId, presence });
        }
      }
    } catch (err) {
      console.error("[Presence] notify friends error:", err.message);
    }
  }

  // Presence is derived from sockets; friends hear only real changes.
  presenceService.init(io, (userId, presence) => {
    notifyFriendsPresence(userId, presence);
  });
  Room.roomEvents.on("statusChanged", (roomId, status) => {
    presenceService.setRoomStatus(roomId, status);
  });

  // Initialize chat namespace
  initChat(io);

  // Rooms from a previous run are resumed by recoverActiveRooms (app.js),
  // which runs before the server accepts connections.

  // Sweep orphaned grace-period timers (safety net for room-end paths
  // that don't call clearAllGracePeriodsForRoom)
  startGraceSweep();

  // Peak online users / players in games, sampled every 30s
  setInterval(() => {
    sampleConcurrency(presenceService.getConnectedUserCount());
  }, 30 * 1000).unref();

  // Periodic cleanup: end stale rooms with 0 active sockets every 5 minutes
  setInterval(
    async () => {
      try {
        const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
        const result = await Room.updateMany(
          {
            status: { $in: ["waiting", "playing"] },
            activePlayers: 0,
            updatedAt: { $lt: staleThreshold },
          },
          { $set: { status: "ended" } },
        );
        if (result.modifiedCount > 0) {
          console.log(`[Cleanup] Ended ${result.modifiedCount} stale rooms`);
          broadcastRoomsUpdate(io);
        }
      } catch (err) {
        console.error("[Cleanup] Error cleaning stale rooms:", err);
      }
    },
    5 * 60 * 1000,
  );

  // ---- Per-socket rate limiter for gameplay events ----
  // Sliding-1s window. Drops events silently above the limit so accidental
  // double-taps and abusive spam can't flood vote/action handlers.
  const ACTION_RATE_LIMIT = 5;
  const ACTION_RATE_WINDOW_MS = 1000;
  const actionBuckets = new Map(); // socketId -> { windowStart, count }

  function consumeActionToken(socketId) {
    const now = Date.now();
    const bucket = actionBuckets.get(socketId);
    if (!bucket || now - bucket.windowStart >= ACTION_RATE_WINDOW_MS) {
      actionBuckets.set(socketId, { windowStart: now, count: 1 });
      return true;
    }
    if (bucket.count >= ACTION_RATE_LIMIT) return false;
    bucket.count++;
    return true;
  }

  // Leave whatever room this socket is seated in, the same way "home" does.
  async function leaveCurrentRoom(socket) {
    const roomId = socket.gameRoomId;
    if (!roomId) return;
    const wasSpectator = socket.isSpectator;
    socket.gameRoomId = null;
    socket.isSpectator = false;
    presenceService.refreshSocket(socket);
    if (wasSpectator) {
      await leaveSpectator(io, socket, roomId, socket.playerId);
    } else {
      await leaveRoom(io, socket, roomId, socket.playerId, true);
    }
  }

  // Player already in `room.players`: reconnect after a drop, rejoin after
  // leaving (alive or dead), or a repeated join from the same socket.
  async function rejoinSeat(socket, room, playerId) {
    const roomId = room.roomId;
    if (room.status === "ended") {
      socket.emit("roomClosed", { reason: "gameEnded" });
      return;
    }

    takeOverSeat(io, socket, roomId, playerId);
    const wasInGrace = isPlayerInGracePeriod(playerId, roomId);
    const wasInWaitingGrace = isPlayerInWaitingGracePeriod(playerId, roomId);
    if (wasInGrace) cancelGracePeriod(io, roomId, playerId);
    if (wasInWaitingGrace) cancelWaitingGracePeriod(roomId, playerId);

    await seatSocket(io, socket, roomId, playerId);

    if (room.status === "playing") {
      // Mid-game rejoin: send gameReconnected so frontend restores game state
      const me = findPlayer(room, playerId);
      socket.emit("gameReconnected", {
        room,
        roleId: me ? me.roleId : null,
        gamePhase: room.gamePhase || "night",
        timer: getRemainingTime(roomId),
        gameResult: room.gameResult || null,
        rematchAccepted: room.rematchAccepted || [],
        rematchTimer: getRematchRemainingTime(roomId),
        mutedPlayerIds: getMutedPlayers(room),
        declarations: getRoleDeclarations(room),
        skipState: getSkipState(room),
        ...timerPayload(room),
      });
    } else {
      socket.emit("roomJoined", room);
      if (wasInWaitingGrace && room.isPublic) broadcastRoomsUpdate(io);
      if (wasInWaitingGrace && room.isQuickPlay) await evaluateCountdown(io, roomId);
    }
    io.to(roomId).emit("playerJoined", room);
  }

  async function handleJoinRoom(socket, roomId, playerId) {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) {
      socket.emit("joinError", { message: "Room not found" });
      return;
    }

    if (findPlayer(room, playerId)) {
      await rejoinSeat(socket, room, playerId);
      return;
    }

    // Block new players from joining a non-waiting room
    if (room.status === "ended") {
      socket.emit("joinError", { message: "Game has ended" });
      return;
    }
    if (room.status !== "waiting") {
      // Game in progress: don't reject — let the client offer spectate mode.
      socket.emit("gameRunning", {
        roomId,
        playerCount: room.players.length,
        phase: room.gamePhase || "playing",
      });
      return;
    }

    const appSettings = await AppSettings.getSettings();
    if (isMaintenanceActive(appSettings, playerId)) {
      socket.emit("maintenanceMode", {
        message: appSettings.maintenanceMessage,
      });
      return;
    }

    // Block enforcement: refuse if joiner blocks (or is blocked by) anyone
    // already in the room. Rejoins skip this so an existing player can
    // always come back after a block was applied mid-game.
    const partners = await getBlockPartners(playerId);
    if (partners.size > 0 && room.players.some((p) => partners.has(pidOf(p)))) {
      socket.emit("joinError", { message: "لا يمكنك الانضمام إلى هذه الغرفة" });
      return;
    }

    if (room.players.length >= MAX_ROOM_PLAYERS) {
      socket.emit("joinError", { message: "Room is full" });
      return;
    }

    // Atomic: never adds the same player twice and never exceeds the cap,
    // even against writers outside this lock.
    const updatedRoom = await Room.findOneAndUpdate(
      {
        _id: room._id,
        status: "waiting",
        "players.player": { $ne: playerId },
        [`players.${MAX_ROOM_PLAYERS - 1}`]: { $exists: false },
      },
      { $push: { players: { player: playerId } } },
      { new: true },
    ).populate(PLAYER_POPULATE);
    if (!updatedRoom) {
      socket.emit("joinError", { message: "Failed to join room" });
      return;
    }

    await seatSocket(io, socket, roomId, playerId);

    socket.emit("roomJoined", updatedRoom);
    io.to(roomId).emit("playerJoined", updatedRoom);
    if (updatedRoom.isPublic) broadcastRoomsUpdate(io);

    // Re-evaluate quick play countdown when a new player joins
    if (updatedRoom.isQuickPlay) await evaluateCountdown(io, roomId);
  }

  // Connection handler
  io.on("connection", (socket) => {
    console.log("New client connected");
    updatePeakConcurrent(io.engine.clientsCount);

    // Track which room this socket is in and who they are
    socket.gameRoomId = null;
    socket.playerId = null;
    socket.isSpectator = false;

    // --- Per-socket presence queries (any player can check any profile) ---
    socket.on("getPlayerPresence", (userId, callback) => {
      if (typeof callback === "function" && userId) {
        callback(presenceService.getPresence(userId));
      }
    });

    socket.on("getMultiplePresence", (userIds, callback) => {
      if (typeof callback === "function" && Array.isArray(userIds)) {
        callback(presenceService.getMultiplePresence(userIds.slice(0, 50)));
      }
    });

    // Handle room creation
    socket.on("createRoom", async (host) => {
      try {
        if (!host) return;
        const hostId = String(host);
        // Check maintenance mode
        const appSettings = await AppSettings.getSettings();
        if (isMaintenanceActive(appSettings, hostId)) {
          socket.emit("maintenanceMode", {
            message: appSettings.maintenanceMessage,
          });
          return;
        }

        await leaveCurrentRoom(socket);

        const roomId = getRandomString();
        const room = await Room.create({
          roomId,
          host: hostId,
          players: [{ player: hostId }],
        });

        await withRoomLock(roomId, async () => {
          await room.populate(PLAYER_POPULATE);
          await seatSocket(io, socket, roomId, hostId);

          // Notify the host
          socket.emit("roomCreated", { room });
          io.to(roomId).emit("roomUpdated", { room });
        });
      } catch (error) {
        console.error("Error creating room:", error);
        socket.emit("error", { message: "Failed to create room" });
      }
    });

    //public room
    socket.on("publicRoom", (arg) => publicRoom(io, socket, arg));

    socket.on("joinRoom", async (payload) => {
      const { roomId, player } = payload || {};
      if (!roomId || !player) {
        socket.emit("joinError", { message: "Failed to join room" });
        return;
      }
      try {
        if (socket.gameRoomId && socket.gameRoomId !== roomId) {
          await leaveCurrentRoom(socket);
        }
        await withRoomLock(roomId, () =>
          handleJoinRoom(socket, roomId, String(player)),
        );
      } catch (error) {
        console.error("[joinRoom] error:", error);
        socket.emit("joinError", { message: "Failed to join room" });
      }
    });

    // Spectate an in-progress room (read-only join)
    socket.on("spectateRoom", async ({ roomId, userId } = {}) => {
      try {
        if (!roomId || !userId) {
          socket.emit("spectateError", { code: "INVALID_REQUEST" });
          return;
        }
        userId = String(userId);

        const appSettings = await AppSettings.getSettings();
        if (isMaintenanceActive(appSettings, userId)) {
          socket.emit("maintenanceMode", {
            message: appSettings.maintenanceMessage,
          });
          return;
        }

        if (socket.gameRoomId && socket.gameRoomId !== roomId) {
          await leaveCurrentRoom(socket);
        }

        await withRoomLock(roomId, async () => {
          const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
          if (!room) {
            socket.emit("spectateError", { code: "ROOM_NOT_FOUND" });
            return;
          }
          if (room.status !== "playing") {
            socket.emit("spectateError", { code: "ROOM_NOT_PLAYING" });
            return;
          }

          // If user is already a player in this room, never put them in `spectators`.
          // Tell the client to use the normal joinRoom flow (handles the dead-rejoin
          // and grace-period reconnect paths).
          if (findPlayer(room, userId)) {
            socket.emit("spectateError", { code: "USER_IS_PLAYER" });
            return;
          }

          const alreadySpectating = (room.spectators || []).some(
            (s) => s.user?.toString() === userId,
          );
          if (!alreadySpectating && (room.spectators?.length || 0) >= MAX_SPECTATORS) {
            socket.emit("spectateError", { code: "SPECTATORS_FULL" });
            return;
          }

          // Add to spectators only if not already present — $addToSet is unsafe
          // here because the joinedAt default produces a different subdocument on
          // each cast, causing duplicates on every rejoin.
          const updatedRoom =
            (await Room.findOneAndUpdate(
              { roomId, "spectators.user": { $ne: userId } },
              { $push: { spectators: { user: userId } } },
              { new: true },
            ).populate(PLAYER_POPULATE)) || room;

          // Spectators count as "online", not "playing", in presence.
          await seatSocket(io, socket, roomId, userId, { spectator: true });

          socket.emit("spectatorJoined", {
            room: updatedRoom,
            gamePhase: updatedRoom.gamePhase || "night",
            timer: getRemainingTime(roomId),
            gameResult: updatedRoom.gameResult || null,
            rematchAccepted: updatedRoom.rematchAccepted || [],
            rematchTimer: getRematchRemainingTime(roomId),
            mutedPlayerIds: getMutedPlayers(updatedRoom),
            declarations: getRoleDeclarations(updatedRoom),
            skipState: getSkipState(updatedRoom),
            ...timerPayload(updatedRoom),
            isSpectator: true,
          });

          io.to(roomId).emit("spectatorCountChanged", {
            roomId,
            count: updatedRoom.spectators?.length || 0,
          });
        });
      } catch (err) {
        console.error("[spectateRoom] error:", err);
        socket.emit("spectateError", { code: "INTERNAL_ERROR" });
      }
    });

    // Quick play matchmaking
    socket.on("quickPlay", async (playerId) => {
      try {
        if (!playerId) return;
        const appSettings = await AppSettings.getSettings();
        if (isMaintenanceActive(appSettings, playerId)) {
          socket.emit("maintenanceMode", {
            message: appSettings.maintenanceMessage,
          });
          return;
        }
        presenceService.attachSocket(socket, playerId);
        // A repeated tap while already in the open lobby keeps the seat.
        if (socket.gameRoomId && socket.gameRoomId !== getActiveQuickPlayRoomId()) {
          await leaveCurrentRoom(socket);
        }
        await findOrCreateQuickPlayRoom(io, socket, playerId);
      } catch (error) {
        console.error("[QuickPlay] Error:", error);
        socket.emit("joinError", { message: "Failed to join quick play" });
      }
    });

    // Invite a friend to your current room
    socket.on("inviteFriend", async ({ friendId, roomId } = {}) => {
      try {
        const playerId = socket.playerId;
        if (!playerId || !friendId || !roomId) return;

        // Verify they are actually friends
        const friendIds = await friendshipService.getFriendIds(playerId);
        if (!friendIds.includes(friendId)) return;

        // Only allow inviting online friends
        if (!presenceService.isOnline(friendId)) {
          // Send push notification instead
          const sender = await User.findById(playerId).select("name");
          if (sender) {
            await sendPushNotification({
              title: "دعوة للعب",
              body: `${sender.name} يدعوك للانضمام لغرفته!`,
              data: { type: "friend_invite", roomId },
              userIds: [friendId],
              type: "targeted",
            }).catch(() => {});
          }
          return;
        }

        const sender = await User.findById(playerId).select(
          "name frame nameColor equippedProfilePicture",
        );
        emitToUser(friendId, "friendInvite", {
          from: {
            _id: playerId,
            name: sender?.name,
            frame: sender?.frame || null,
            nameColor: sender?.nameColor || null,
            equippedProfilePicture: sender?.equippedProfilePicture || null,
          },
          roomId,
        });
      } catch (err) {
        console.error("[inviteFriend] Error:", err);
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
      const playerId = socket.playerId;
      const roomId = socket.gameRoomId;
      const wasSpectator = socket.isSpectator;
      socket.gameRoomId = null;
      socket.isSpectator = false;
      presenceService.detachSocket(socket);
      actionBuckets.delete(socket.id);

      // Shutting down: the room state stays as-is and is resumed on restart.
      if (io.shuttingDown) return;

      if (roomId) {
        const leaving = wasSpectator
          ? leaveSpectator(io, socket, roomId, playerId)
          : leaveRoom(io, socket, roomId, playerId, false);
        leaving.catch((err) => console.error("[disconnect] leave failed:", err));
      }
    });

    socket.on("home", async (clientUserId) => {
      // Prefer the trusted server-side socket.playerId; fall back to the
      // client-supplied userId so a fresh socket sitting on the home screen
      // (no room joined yet) still registers presence and counts as online.
      const playerId = socket.playerId || (clientUserId ? String(clientUserId) : null);
      if (playerId && !socket.playerId) {
        socket.playerId = playerId;
      }
      let roomId = socket.gameRoomId;
      const wasSpectator = socket.isSpectator;

      // Player is back at home — online regardless of room state.
      socket.gameRoomId = null;
      socket.isSpectator = false;
      if (playerId) presenceService.attachSocket(socket, playerId);

      // If socket state is out of sync, fall back to DB to find any active room
      // the player is still part of. This covers race conditions where the socket
      // lost its gameRoomId but the backend still has the player in a room.
      // Skip the DB fallback for spectators — they're not in `players`.
      if (!roomId && playerId && !wasSpectator) {
        try {
          const staleRoom = await Room.findOne(
            {
              status: { $in: ["waiting", "playing"] },
              "players.player": playerId,
            },
            "roomId",
          ).lean();
          if (staleRoom) {
            roomId = staleRoom.roomId;
          }
        } catch (err) {
          console.error("[home] DB fallback lookup failed:", err);
        }
      }

      if (roomId) {
        try {
          if (wasSpectator) {
            await leaveSpectator(io, socket, roomId, playerId);
          } else {
            await leaveRoom(io, socket, roomId, playerId, true);
          }
        } catch (err) {
          console.error("[home] leave failed:", err);
        }
      }
    });

    // Wraps a game-action listener so spectators (read-only sockets) cannot
    // submit votes, mute, declare roles, accept rematches, etc. Also enforces
    // a per-socket rate limit so vote/action events can't be flooded.
    const playerOnly =
      (handler) =>
      (arg, ack) => {
        // Handlers that use acks receive the callback as Socket.IO's last arg.
        // Reject early-returns with a failure ack so an optimistic client can
        // reconcile instead of hanging until its timeout fires.
        if (socket.isSpectator) {
          if (typeof ack === "function") ack({ ok: false, reason: "spectator" });
          return;
        }
        if (!consumeActionToken(socket.id)) {
          if (typeof ack === "function")
            ack({ ok: false, reason: "rate_limited" });
          return;
        }
        return handler(arg, ack);
      };

    //start the game (do not allow players to join)
    socket.on("startGame", async (arg) => {
      if (socket.isSpectator) return;
      try {
        await startGame(io, socket, arg);
      } catch (err) {
        console.error("[startGame] error:", err);
      }
    });

    // Add more event listeners here
    socket.on("assignRoles", playerOnly((arg) => assignRoles(io, socket, arg)));

    //----------------------------------------------------------------
    //acions
    socket.on("b3atiAction", playerOnly((arg) => ba3atiAction(io, socket, arg)));
    socket.on(
      "al3omdaAction",
      playerOnly((arg) => al3omdaAction(io, socket, arg)),
    );
    socket.on(
      "damazeenAction",
      playerOnly((arg) => damazeenAction(io, socket, arg)),
    );
    socket.on(
      "damazeenProtection",
      playerOnly((arg) => damazeenProtection(io, socket, arg)),
    );
    socket.on(
      "sitAlwada3Action",
      playerOnly((arg) => sitAlwada3Action(io, socket, arg)),
    );
    socket.on(
      "abuJanzeerAction",
      playerOnly((arg) => abuJanzeerAction(io, socket, arg)),
    );
    socket.on(
      "ballahAction",
      playerOnly((arg) => ballahAction(io, socket, arg)),
    );
    socket.on(
      "ba3atiKabeerAction",
      playerOnly((arg) => ba3atiKabeerAction(io, socket, arg)),
    );
    socket.on(
      "ba3atiKabeerConvert",
      playerOnly((arg) => ba3atiKabeerConvert(io, socket, arg)),
    );
    socket.on(
      "jenabuAction",
      playerOnly((arg) => jenabuAction(io, socket, arg)),
    );
    socket.on(
      "wadAlzalatAction",
      playerOnly((arg) => wadAlzalatAction(io, socket, arg)),
    );
    socket.on(
      "skipNightAction",
      playerOnly((arg) => skipNightAction(io, socket, arg)),
    );
    //................................................................

    //----------------------------------------------------------------
    //votes
    socket.on("vote", playerOnly((arg) => voteSubmit(io, socket, arg)));
    socket.on("skipVote", playerOnly((arg) => voteSkip(io, socket, arg)));
    socket.on(
      "skipDiscussion",
      playerOnly((arg, ack) => skipDiscussionVote(io, socket, arg, ack)),
    );
    socket.on(
      "mutePlayer",
      playerOnly((arg) => mutePlayerToggle(io, socket, arg)),
    );
    socket.on(
      "declareRole",
      playerOnly((arg) => handleDeclareRole(io, socket, arg)),
    );
    //............................................................

    //----------------------------------------------------------------
    //rematch
    socket.on("rematchStart", playerOnly((arg) => startRematch(io, socket, arg)));
    socket.on(
      "rematchAccept",
      playerOnly((arg) => acceptRematch(io, socket, arg)),
    );
    socket.on(
      "rematchBegin",
      playerOnly((arg) => beginRematch(io, socket, arg)),
    );
    // Spectators opt into the rematch and become players — must NOT use
    // playerOnly (that early-returns for spectators). Still rate-limited.
    socket.on("rematchJoin", async (arg) => {
      if (!consumeActionToken(socket.id)) return;
      try {
        await joinRematch(io, socket, arg);
      } catch (err) {
        console.error("[rematchJoin] error:", err);
      }
    });
    //............................................................
  });

  return io;
};
