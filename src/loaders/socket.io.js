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
  skipNightAction,
} = require("../api/game/room.actions");
const { voteSubmit } = require("../api/game/votes.game");
const { skipDiscussionVote } = require("../api/game/skipDiscussion.game");
const {
  getActiveRooms,
  joinRoom,
  leaveRoom,
  publicRoom,
} = require("../api/controllers/room.controller");
const {
  cancelGracePeriod,
  isPlayerInGracePeriod,
} = require("../api/game/disconnect.game");
const initChat = require("../api/services/chat.service");

module.exports = (server) => {
  const io = SocketIO(server, {
    cors: {
      origin: config.env === "production" ? "PRODUCTION_URL" : "*",
      methods: ["GET", "POST"],
    },
  });

  function getRandomString(length = 7) {
    return Math.random()
      .toString(36)
      .substring(2, 2 + length);
  }
  // Initialize chat namespace
  initChat(io);

  // Connection handler
  io.on("connection", (socket) => {
    console.log("New client connected");

    // Track which room this socket is in and who they are
    socket.gameRoomId = null;
    socket.playerId = null;

    // Handle room creation
    socket.on("createRoom", async (host) => {
      try {
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

        let updatedRoom;
        if (alreadyInRoom) {
          // Cancel grace period if player was disconnected
          if (isPlayerInGracePeriod(player)) {
            cancelGracePeriod(io, roomId, player);
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
            });
          } else {
            socket.emit("roomJoined", updatedRoom);
          }
          io.to(roomId).emit("playerJoined", updatedRoom);
        } else {
          // Block new players from joining a game in progress
          if (room.status !== "waiting") {
            socket.emit("joinError", { message: "Game already in progress" });
            return;
          }

          if (room.players.length >= 15) {
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
        }
      } catch (error) {
        socket.emit("joinError", { message: "Failed to join room" });
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
      if (socket.gameRoomId) {
        leaveRoom(io, socket, socket.gameRoomId, socket.playerId);
        socket.gameRoomId = null;
        socket.playerId = null;
      }
    });

    socket.on("home", () => {
      if (socket.gameRoomId) {
        leaveRoom(io, socket, socket.gameRoomId, socket.playerId);
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
    socket.on("skipNightAction", (arg) => skipNightAction(io, socket, arg));
    //................................................................

    //----------------------------------------------------------------
    //votes
    socket.on("vote", (arg) => voteSubmit(io, socket, arg));
    socket.on("skipDiscussion", (arg) => skipDiscussionVote(io, socket, arg));
    //............................................................

  });

  return io;
};
