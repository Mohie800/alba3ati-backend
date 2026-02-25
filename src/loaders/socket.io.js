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
} = require("../api/game/room.actions");
const { voteSubmit } = require("../api/game/votes.game");
const {
  getActiveRooms,
  joinRoom,
  leaveRoom,
  publicRoom,
} = require("../api/controllers/room.controller");

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
  // Connection handler
  io.on("connection", (socket) => {
    console.log("New client connected");

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

        // Notify the host
        // console.log(roomDetails);
        socket.emit("roomCreated", {
          room: roomDetails,
        });

        // Notify all clients in the room
        io.to(roomId).emit("roomUpdated", { room });
        const rooms = await getActiveRooms();
        io.emit("roomsUpdate", rooms);
        socket.on("disconnect", () => {
          leaveRoom(io, socket, roomId);
        });
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
        const room = await Room.findOne({ roomId });

        if (!room) {
          socket.emit("joinError", { message: "Room not found" });
          return;
        }

        if (room.players.length >= 15) {
          // Example player limit
          socket.emit("joinError", { message: "Room is full" });
          return;
        }

        const updatedRoom = await Room.findByIdAndUpdate(
          room._id,
          { $push: { players: { player } } },
          { new: true }
        ).populate("players.player");

        joinRoom(io, socket, roomId);
        socket.emit("roomJoined", updatedRoom);
        io.to(roomId).emit("playerJoined", updatedRoom);
        socket.on("disconnect", () => {
          leaveRoom(io, socket, roomId);
          console.log("dddd");
        });
      } catch (error) {
        socket.emit("joinError", { message: "Failed to join room" });
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
    socket.on("home", () => {
      //leave all rooms
      console.log(socket.rooms);
      const rooms = Array.from(socket.rooms);

      rooms.map((room, i) => {
        if (i === 0) return;
        socket.leave(room);
      });
      console.log(socket.rooms);
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
    //................................................................

    //----------------------------------------------------------------
    //votes
    socket.on("vote", (arg) => voteSubmit(io, socket, arg));
    //............................................................

    //----------------------------------------------------------------
    //audio streams
    socket.on("offer", ({ roomId, offer, target }) => {
      console.log("offer");
      socket.to(roomId).emit("offer", { offer, senderId: socket.id });
    });

    socket.on("answer", ({ roomId, answer, target }) => {
      socket.to(roomId).emit("answer", { answer });
    });

    socket.on("ice-candidate", ({ roomId, candidate, target }) => {
      console.log("ice");
      socket.to(roomId).emit("ice-candidate", { candidate });
    });

    socket.on("speaking-state", ({ roomId, playerId, isSpeaking }) => {
      socket.to(roomId).emit("speaking-update", { playerId, isSpeaking });
    });
    //................................................................
  });

  return io;
};
