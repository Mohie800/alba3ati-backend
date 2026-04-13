const SocketIO = require("socket.io");
const config = require("../config/config");

const Room = require("../api/models/room.model");
const User = require("../api/models/user.model");
const GameRound = require("../api/models/gameRound.model");
const {
  sendPushNotification,
} = require("../api/services/pushNotification.service");
const presenceService = require("../api/services/presence.service");
const friendshipService = require("../api/services/friendship.service");
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
const { skipDiscussionVote } = require("../api/game/skipDiscussion.game");
const {
  mutePlayerToggle,
  getMutedPlayers,
} = require("../api/game/mutePlayer.game");
const {
  handleDeclareRole,
  clearRoleDeclarations,
  getRoleDeclarations,
} = require("../api/game/declareRole.game");
const { getRemainingTime } = require("../api/game/timer.game");
const {
  getActiveRooms,
  joinRoom,
  leaveRoom,
  publicRoom,
} = require("../api/controllers/room.controller");
const {
  cancelGracePeriod,
  isPlayerInGracePeriod,
  cancelWaitingGracePeriod,
  isPlayerInWaitingGracePeriod,
} = require("../api/game/disconnect.game");
const initChat = require("../api/services/chat.service");
const AppSettings = require("../api/models/appSettings.model");
const { findOrCreateQuickPlayRoom } = require("../api/game/quickPlay.game");
const {
  startRematch,
  acceptRematch,
  beginRematch,
  getRematchRemainingTime,
} = require("../api/game/rematch.game");
const { updatePeakConcurrent } = require("../api/game/dailyStats.game");

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

  function getRandomString(length = 7) {
    return Math.random()
      .toString(36)
      .substring(2, 2 + length);
  }

  // userId → Set of socketIds (for targeted events and presence)
  const userSockets = new Map();

  function emitToUser(userId, event, data) {
    const sockets = userSockets.get(userId.toString());
    if (sockets) {
      for (const socketId of sockets) {
        io.to(socketId).emit(event, data);
      }
    }
  }

  // Inject emitToUser into friendship service so it can emit events on request/accept/etc.
  friendshipService.setEmitToUser(emitToUser);

  /**
   * Notify a player's online friends that they joined/created a room.
   * Throttled to once per 5 minutes per (player, friend) pair.
   */
  async function notifyFriendsJoinedRoom(userId, playerName, roomId, isPublic) {
    try {
      const [friendIds, player] = await Promise.all([
        friendshipService.getFriendIds(userId.toString()),
        User.findById(userId).select("name"),
      ]);
      const name = player?.name || playerName;

      for (const friendId of friendIds) {
        const allowed = friendshipService.checkAndSetNotifyThrottle(
          userId.toString(),
          friendId,
        );
        if (!allowed) continue;

        if (presenceService.isOnline(friendId)) {
          // Real-time event for online friends
          emitToUser(friendId, "friendJoinedRoom", {
            friend: { _id: userId, name },
            roomId,
            isPublic: !!isPublic,
          });
        }
      }
    } catch (err) {
      // Non-critical
    }
  }

  // Initialize chat namespace
  initChat(io);

  // Clean up orphaned rooms from previous server runs
  // (grace period timers are in-memory and lost on restart)
  Room.updateMany(
    { status: { $in: ["waiting", "playing"] } },
    { $set: { status: "ended" } },
  )
    .exec()
    .then((result) => {
      if (result.modifiedCount > 0) {
        console.log(
          `[Cleanup] Ended ${result.modifiedCount} orphaned rooms from previous run`,
        );
      }
    });

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
          const rooms = await getActiveRooms();
          io.emit("roomsUpdate", rooms);
        }
      } catch (err) {
        console.error("[Cleanup] Error cleaning stale rooms:", err);
      }
    },
    5 * 60 * 1000,
  );

  // --- Presence helpers (shared across all connections) ---

  /**
   * Register a socket for a player. Cancels any pending offline debounce.
   * Does NOT set presence state — callers decide (setOnline vs setPlaying).
   */
  function registerUserSocket(socket, playerId) {
    const id = playerId?.toString();
    if (!id) return;
    if (!userSockets.has(id)) userSockets.set(id, new Set());
    userSockets.get(id).add(socket.id);
    presenceService.cancelPendingOffline(id);
  }

  /**
   * Unregister a socket. When no sockets remain, schedules debounced offline.
   */
  function unregisterUserSocket(socket, playerId) {
    const id = playerId?.toString();
    if (!id) return;
    const sockets = userSockets.get(id);
    if (!sockets) return;
    sockets.delete(socket.id);
    if (sockets.size === 0) {
      userSockets.delete(id);
      presenceService.scheduleOffline(id, (uid) => {
        notifyFriendsPresence(uid);
      });
    }
  }

  /**
   * Broadcast presence update to a player's online friends.
   */
  async function notifyFriendsPresence(userId) {
    try {
      const id = userId.toString();
      const friendIds = await friendshipService.getFriendIds(id);
      const presence = presenceService.getPresence(id);
      for (const friendId of friendIds) {
        if (presenceService.isOnline(friendId)) {
          emitToUser(friendId, "friendPresenceUpdate", {
            userId: id,
            presence,
          });
        }
      }
    } catch (err) {
      console.error("[Presence] notify friends error:", err.message);
    }
  }

  // Connection handler
  io.on("connection", (socket) => {
    console.log("New client connected");
    updatePeakConcurrent(io.engine.clientsCount);

    // Track which room this socket is in and who they are
    socket.gameRoomId = null;
    socket.playerId = null;

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
        // Check maintenance mode
        const appSettings = await AppSettings.getSettings();
        if (appSettings.maintenanceMode) {
          socket.emit("maintenanceMode", {
            message: appSettings.maintenanceMessage,
          });
          return;
        }

        const roomId = getRandomString();

        // Create a new room
        const room = await Room.create({
          roomId,
          host,
          players: [{ player: host }],
        });

        await room.populate("players.player");

        // Join the room
        joinRoom(io, socket, roomId);
        socket.gameRoomId = roomId;
        socket.playerId = host;

        // Presence: register socket and set playing
        registerUserSocket(socket, host);
        presenceService.setPlaying(host, roomId);
        notifyFriendsPresence(host);

        // Notify friends that this player created a room
        notifyFriendsJoinedRoom(
          host,
          room.host?.toString?.() || host,
          roomId,
          room.isPublic,
        ).catch(() => {});

        // Notify the host
        socket.emit("roomCreated", { room });

        // Notify all clients in the room
        io.to(roomId).emit("roomUpdated", { room });

        // Update public rooms list without blocking the response
        getActiveRooms()
          .then((rooms) => io.emit("roomsUpdate", rooms))
          .catch((err) => console.error("Error updating rooms list:", err));
      } catch (error) {
        console.error("Error creating room:", error);
        socket.emit("error", { message: "Failed to create room" });
      }
    });

    //public room
    socket.on("publicRoom", (arg) => publicRoom(io, socket, arg));

    // Backend Socket.IO handlers
    socket.on("joinRoom", async ({ roomId, player }) => {
      try {
        const room = await Room.findOne({ roomId }).populate("players.player");

        if (!room) {
          socket.emit("joinError", { message: "Room not found" });
          return;
        }

        // Check if player already exists in room (reconnect scenario)
        const alreadyInRoom = room.players.some(
          (p) => p.player._id.toString() === player,
        );

        // Check maintenance mode (allow reconnects to pass through)
        if (!alreadyInRoom) {
          const appSettings = await AppSettings.getSettings();
          if (appSettings.maintenanceMode) {
            socket.emit("maintenanceMode", {
              message: appSettings.maintenanceMessage,
            });
            return;
          }
        }

        let updatedRoom;
        if (alreadyInRoom) {
          // Room ended while player was away — kick them out
          if (room.status === "ended") {
            socket.emit("roomClosed", { reason: "gameEnded" });
            return;
          }

          const wasInGrace = isPlayerInGracePeriod(player);
          const wasInWaitingGrace = isPlayerInWaitingGracePeriod(player);

          // Allow dead players who left mid-game to rejoin as spectators
          const me = room.players.find(
            (p) => p.player._id.toString() === player,
          );
          const isDeadSpectator =
            room.status === "playing" &&
            me &&
            me.status === "dead" &&
            me.leftMidGame;

          // Block duplicate joins for players who are already connected in the room.
          // Rejoin is only allowed when the player is in a disconnect grace period
          // or when a dead player returns to spectate.
          if (!wasInGrace && !wasInWaitingGrace && !isDeadSpectator) {
            socket.emit("joinError", { message: "Already joined this room" });
            return;
          }

          // Cancel grace periods if player was disconnected
          if (wasInGrace) {
            cancelGracePeriod(io, roomId, player);
          }
          if (wasInWaitingGrace) {
            cancelWaitingGracePeriod(roomId, player);
          }

          // Rejoin socket room without adding duplicate player entry
          updatedRoom = room;

          joinRoom(io, socket, roomId);
          socket.gameRoomId = roomId;
          socket.playerId = player;

          // Presence: register socket on reconnect
          registerUserSocket(socket, player);
          presenceService.setPlaying(player, roomId, room.status);
          notifyFriendsPresence(player);

          if (room.status === "playing") {
            // Mid-game rejoin: send gameReconnected so frontend restores game state
            const me = room.players.find(
              (p) => p.player._id.toString() === player,
            );
            socket.emit("gameReconnected", {
              room: updatedRoom,
              roleId: me ? me.roleId : null,
              gamePhase: updatedRoom.gamePhase || "night",
              timer: getRemainingTime(roomId),
              gameResult: updatedRoom.gameResult || null,
              rematchAccepted: updatedRoom.rematchAccepted || [],
              rematchTimer: getRematchRemainingTime(roomId),
              mutedPlayerIds: getMutedPlayers(roomId),
              declarations: getRoleDeclarations(roomId),
            });
          } else {
            socket.emit("roomJoined", updatedRoom);
            // Refresh public rooms list so the room reappears after reconnect
            if (wasInWaitingGrace && updatedRoom.isPublic) {
              const rooms = await getActiveRooms();
              io.emit("roomsUpdate", rooms);
            }
            // Re-evaluate quick play countdown on reconnect
            if (wasInWaitingGrace && updatedRoom.isQuickPlay) {
              const {
                evaluateCountdown,
              } = require("../api/game/quickPlay.game");
              evaluateCountdown(io, roomId);
            }
          }
          io.to(roomId).emit("playerJoined", updatedRoom);
        } else {
          // Block new players from joining a non-waiting room
          if (room.status === "ended") {
            socket.emit("joinError", { message: "Game has ended" });
            return;
          }
          if (room.status !== "waiting") {
            socket.emit("joinError", { message: "Game already started" });
            return;
          }

          if (room.players.length >= 20) {
            socket.emit("joinError", { message: "Room is full" });
            return;
          }

          updatedRoom = await Room.findByIdAndUpdate(
            room._id,
            { $push: { players: { player } } },
            { new: true },
          ).populate("players.player");

          joinRoom(io, socket, roomId);
          socket.gameRoomId = roomId;
          socket.playerId = player;

          // Presence: set playing and notify friends
          registerUserSocket(socket, player);
          presenceService.setPlaying(player, roomId);
          notifyFriendsPresence(player);
          notifyFriendsJoinedRoom(
            player,
            player,
            roomId,
            updatedRoom.isPublic,
          ).catch(() => {});

          socket.emit("roomJoined", updatedRoom);
          io.to(roomId).emit("playerJoined", updatedRoom);

          // Re-evaluate quick play countdown when a new player joins
          if (updatedRoom.isQuickPlay) {
            const { evaluateCountdown } = require("../api/game/quickPlay.game");
            evaluateCountdown(io, roomId);
          }

          // if (
          //   updatedRoom.isPublic &&
          //   !updatedRoom.isQuickPlay &&
          //   updatedRoom.status === "waiting" &&
          //   updatedRoom.players.length === 3
          // ) {
          //   try {
          //     const markedRoom = await Room.findOneAndUpdate(
          //       {
          //         _id: updatedRoom._id,
          //         publicRoomReadyNotifiedAt: null,
          //       },
          //       { $set: { publicRoomReadyNotifiedAt: new Date() } },
          //       { new: true },
          //     );

          //     if (markedRoom) {
          //       const roomPlayerIds = updatedRoom.players
          //         .map((p) => p.player?._id?.toString())
          //         .filter(Boolean);

          //       const recipients = await User.find({
          //         _id: { $nin: roomPlayerIds },
          //         expoPushToken: { $ne: null },
          //         $or: [
          //           {
          //             "notificationPreferences.publicRooms": { $exists: false },
          //           },
          //           { "notificationPreferences.publicRooms": true },
          //         ],
          //       }).select("_id");

          //       const recipientIds = recipients.map((u) => u._id.toString());

          //       if (recipientIds.length > 0) {
          //         await sendPushNotification({
          //           title: "غرفة عامة جاهزة",
          //           body: "تم الوصول إلى 3 لاعبين. انضم الآن!",
          //           data: {
          //             screen: "room",
          //             roomId: updatedRoom.roomId,
          //             playerCount: 3,
          //             type: "public_room_ready",
          //           },
          //           userIds: recipientIds,
          //           type: "targeted",
          //         });
          //       }
          //     }
          //   } catch (notifErr) {
          //     console.error("Public room ready notification error:", notifErr);
          //   }
          // }
        }
      } catch (error) {
        socket.emit("joinError", { message: "Failed to join room" });
      }
    });

    // Quick play matchmaking
    socket.on("quickPlay", async (playerId) => {
      try {
        const appSettings = await AppSettings.getSettings();
        if (appSettings.maintenanceMode) {
          socket.emit("maintenanceMode", {
            message: appSettings.maintenanceMessage,
          });
          return;
        }
        // Register presence before entering quick play
        registerUserSocket(socket, playerId);
        presenceService.setOnline(playerId);
        await findOrCreateQuickPlayRoom(io, socket, playerId);
      } catch (error) {
        console.error("[QuickPlay] Error:", error);
        socket.emit("joinError", { message: "Failed to join quick play" });
      }
    });

    // Invite a friend to your current room
    socket.on("inviteFriend", async ({ friendId, roomId }) => {
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

        const sender = await User.findById(playerId).select("name frame");
        emitToUser(friendId, "friendInvite", {
          from: { _id: playerId, name: sender?.name },
          roomId,
        });
      } catch (err) {
        console.error("[inviteFriend] Error:", err);
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
      const playerId = socket.playerId;
      if (socket.gameRoomId) {
        leaveRoom(io, socket, socket.gameRoomId, playerId, false);
        socket.gameRoomId = null;
      }

      // Debounced presence cleanup (waits before marking offline)
      if (playerId) {
        unregisterUserSocket(socket, playerId);
      }
      socket.playerId = null;
    });

    socket.on("home", async () => {
      const playerId = socket.playerId;
      let roomId = socket.gameRoomId;

      // If socket state is out of sync, fall back to DB to find any active room
      // the player is still part of. This covers race conditions where the socket
      // lost its gameRoomId but the backend still has the player in a room.
      if (!roomId && playerId) {
        try {
          const staleRoom = await Room.findOne({
            status: { $in: ["waiting", "playing"] },
            "players.player": playerId,
          });
          if (staleRoom) {
            roomId = staleRoom.roomId;
          }
        } catch (err) {
          console.error("[home] DB fallback lookup failed:", err);
        }
      }

      if (roomId) {
        leaveRoom(io, socket, roomId, playerId, true);
        socket.gameRoomId = null;
        // Don't null playerId — socket is still connected, need it for disconnect cleanup
      }

      // Player is back at home — mark online regardless of room state
      if (playerId) {
        presenceService.setOnline(playerId);
        notifyFriendsPresence(playerId);
      }
    });

    //start the game (do not allow players to join)
    socket.on("startGame", async (arg) => {
      await startGame(io, socket, arg);
      // Update presence for all players so friends see roomStatus: "playing"
      const { roomId } = arg || {};
      if (!roomId) return;
      try {
        const startedRoom = await Room.findOne({ roomId }).lean();
        if (startedRoom?.status === "playing") {
          for (const p of startedRoom.players) {
            const pid = p.player?.toString();
            if (!pid) continue;
            presenceService.setPlaying(pid, roomId, "playing");
            notifyFriendsPresence(pid).catch(() => {});
          }
        }
      } catch (err) {
        console.error("[startGame] presence update error:", err);
      }
    });

    // Add more event listeners here
    socket.on("assignRoles", (arg) => assignRoles(io, socket, arg));

    //----------------------------------------------------------------
    //acions
    socket.on("b3atiAction", (arg) => ba3atiAction(io, socket, arg));
    socket.on("al3omdaAction", (arg) => al3omdaAction(io, socket, arg));
    socket.on("damazeenAction", (arg) => damazeenAction(io, socket, arg));
    socket.on("damazeenProtection", (arg) =>
      damazeenProtection(io, socket, arg),
    );
    socket.on("sitAlwada3Action", (arg) => sitAlwada3Action(io, socket, arg));
    socket.on("abuJanzeerAction", (arg) => abuJanzeerAction(io, socket, arg));
    socket.on("ballahAction", (arg) => ballahAction(io, socket, arg));
    socket.on("ba3atiKabeerAction", (arg) =>
      ba3atiKabeerAction(io, socket, arg),
    );
    socket.on("ba3atiKabeerConvert", (arg) =>
      ba3atiKabeerConvert(io, socket, arg),
    );
    socket.on("jenabuAction", (arg) => jenabuAction(io, socket, arg));
    socket.on("wadAlzalatAction", (arg) => wadAlzalatAction(io, socket, arg));
    socket.on("skipNightAction", (arg) => skipNightAction(io, socket, arg));
    //................................................................

    //----------------------------------------------------------------
    //votes
    socket.on("vote", (arg) => voteSubmit(io, socket, arg));
    socket.on("skipVote", (arg) => voteSkip(io, socket, arg));
    socket.on("skipDiscussion", (arg) => skipDiscussionVote(io, socket, arg));
    socket.on("mutePlayer", (arg) => mutePlayerToggle(io, socket, arg));
    socket.on("declareRole", (arg) => handleDeclareRole(io, socket, arg));
    //............................................................

    //----------------------------------------------------------------
    //rematch
    socket.on("rematchStart", (arg) => startRematch(io, socket, arg));
    socket.on("rematchAccept", (arg) => acceptRematch(io, socket, arg));
    socket.on("rematchBegin", (arg) => beginRematch(io, socket, arg));
    //............................................................
  });

  return io;
};
