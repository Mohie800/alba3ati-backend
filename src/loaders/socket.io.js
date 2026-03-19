const SocketIO = require("socket.io");
const config = require("../config/config");

const Room = require("../api/models/room.model");
const GameRound = require("../api/models/gameRound.model");
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
} = require("../api/game/room.actions");
const { voteSubmit, voteSkip } = require("../api/game/votes.game");
const { skipDiscussionVote } = require("../api/game/skipDiscussion.game");
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
  // Initialize chat namespace
  initChat(io);

  // Clean up orphaned rooms from previous server runs
  // (grace period timers are in-memory and lost on restart)
  Room.updateMany(
    { status: { $in: ["waiting", "playing"] } },
    { $set: { status: "ended" } }
  ).exec().then((result) => {
    if (result.modifiedCount > 0) {
      console.log(`[Cleanup] Ended ${result.modifiedCount} orphaned rooms from previous run`);
    }
  });

  // Periodic cleanup: end stale rooms with 0 active sockets every 5 minutes
  setInterval(async () => {
    try {
      const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
      const result = await Room.updateMany(
        {
          status: { $in: ["waiting", "playing"] },
          activePlayers: 0,
          updatedAt: { $lt: staleThreshold },
        },
        { $set: { status: "ended" } }
      );
      if (result.modifiedCount > 0) {
        console.log(`[Cleanup] Ended ${result.modifiedCount} stale rooms`);
        const rooms = await getActiveRooms();
        io.emit("roomsUpdate", rooms);
      }
    } catch (err) {
      console.error("[Cleanup] Error cleaning stale rooms:", err);
    }
  }, 5 * 60 * 1000);

  // Connection handler
  io.on("connection", (socket) => {
    console.log("New client connected");
    updatePeakConcurrent(io.engine.clientsCount);

    // Track which room this socket is in and who they are
    socket.gameRoomId = null;
    socket.playerId = null;

    // Handle room creation
    socket.on("createRoom", async (host) => {
      try {
        // Check maintenance mode
        const appSettings = await AppSettings.getSettings();
        if (appSettings.maintenanceMode) {
          socket.emit("maintenanceMode", { message: appSettings.maintenanceMessage });
          return;
        }

        const roomId = getRandomString();

        // Create a new room
        const room = await Room.create({
          roomId,
          host,
          players: [{ player: host }],
        });

        const roomDetails = await Room.findOne({ roomId }).populate(
          "players.player"
        );
        // Join the room
        joinRoom(io, socket, roomId);
        socket.gameRoomId = roomId;
        socket.playerId = host;

        // Notify the host
        socket.emit("roomCreated", {
          room: roomDetails,
        });

        // Notify all clients in the room
        io.to(roomId).emit("roomUpdated", { room });
        const rooms = await getActiveRooms();
        io.emit("roomsUpdate", rooms);
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
          (p) => p.player._id.toString() === player
        );

        // Check maintenance mode (allow reconnects to pass through)
        if (!alreadyInRoom) {
          const appSettings = await AppSettings.getSettings();
          if (appSettings.maintenanceMode) {
            socket.emit("maintenanceMode", { message: appSettings.maintenanceMessage });
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

          // Cancel grace periods if player was disconnected
          if (isPlayerInGracePeriod(player)) {
            cancelGracePeriod(io, roomId, player);
          }
          const wasInWaitingGrace = isPlayerInWaitingGracePeriod(player);
          if (wasInWaitingGrace) {
            cancelWaitingGracePeriod(roomId, player);
          }

          // Rejoin socket room without adding duplicate player entry
          updatedRoom = room;

          joinRoom(io, socket, roomId);
          socket.gameRoomId = roomId;
          socket.playerId = player;

          if (room.status === "playing") {
            // Mid-game rejoin: send gameReconnected so frontend restores game state
            const me = room.players.find(
              (p) => p.player._id.toString() === player
            );
            socket.emit("gameReconnected", {
              room: updatedRoom,
              roleId: me ? me.roleId : null,
              gamePhase: updatedRoom.gamePhase || "night",
              timer: getRemainingTime(roomId),
              gameResult: updatedRoom.gameResult || null,
              rematchAccepted: updatedRoom.rematchAccepted || [],
              rematchTimer: getRematchRemainingTime(roomId),
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
              const { evaluateCountdown } = require("../api/game/quickPlay.game");
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
            { new: true }
          ).populate("players.player");

          joinRoom(io, socket, roomId);
          socket.gameRoomId = roomId;
          socket.playerId = player;

          socket.emit("roomJoined", updatedRoom);
          io.to(roomId).emit("playerJoined", updatedRoom);

          // Re-evaluate quick play countdown when a new player joins
          if (updatedRoom.isQuickPlay) {
            const { evaluateCountdown } = require("../api/game/quickPlay.game");
            evaluateCountdown(io, roomId);
          }
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
          socket.emit("maintenanceMode", { message: appSettings.maintenanceMessage });
          return;
        }
        await findOrCreateQuickPlayRoom(io, socket, playerId);
      } catch (error) {
        console.error("[QuickPlay] Error:", error);
        socket.emit("joinError", { message: "Failed to join quick play" });
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
      if (socket.gameRoomId) {
        leaveRoom(io, socket, socket.gameRoomId, socket.playerId, false);
        socket.gameRoomId = null;
        socket.playerId = null;
      }
    });

    socket.on("home", () => {
      if (socket.gameRoomId) {
        leaveRoom(io, socket, socket.gameRoomId, socket.playerId, true);
        socket.gameRoomId = null;
        socket.playerId = null;
      }
    });

    //start the game (do not allow players to join)
    socket.on("startGame", (arg) => startGame(io, socket, arg));

    // Add more event listeners here
    socket.on("assignRoles", (arg) => assignRoles(io, socket, arg));

    //----------------------------------------------------------------
    //acions
    socket.on("b3atiAction", (arg) => ba3atiAction(io, socket, arg));
    socket.on("al3omdaAction", (arg) => al3omdaAction(io, socket, arg));
    socket.on("damazeenAction", (arg) => damazeenAction(io, socket, arg));
    socket.on("damazeenProtection", (arg) =>
      damazeenProtection(io, socket, arg)
    );
    socket.on("sitAlwada3Action", (arg) => sitAlwada3Action(io, socket, arg));
    socket.on("abuJanzeerAction", (arg) => abuJanzeerAction(io, socket, arg));
    socket.on("ballahAction", (arg) => ballahAction(io, socket, arg));
    socket.on("skipNightAction", (arg) => skipNightAction(io, socket, arg));
    //................................................................

    //----------------------------------------------------------------
    //votes
    socket.on("vote", (arg) => voteSubmit(io, socket, arg));
    socket.on("skipVote", (arg) => voteSkip(io, socket, arg));
    socket.on("skipDiscussion", (arg) => skipDiscussionVote(io, socket, arg));
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
