module.exports = (io) => {
  io.of("/chat").on("connection", (socket) => {
    console.log("User connected to chat namespace");

    // joinRoom may be called as `joinRoom(room)` (legacy) or
    // `joinRoom({ room, isSpectator })` so spectators stay read-only.
    socket.on("joinRoom", (payload) => {
      let room;
      let isSpectator = false;
      if (payload && typeof payload === "object") {
        room = payload.room;
        isSpectator = !!payload.isSpectator;
      } else {
        room = payload;
      }
      if (!room) return;
      socket.data = socket.data || {};
      socket.data.isSpectator = isSpectator;
      socket.join(room);
    });

    socket.on("sendMessage", (data) => {
      // Spectators may receive newMessage broadcasts but cannot send.
      if (socket.data && socket.data.isSpectator) return;
      io.of("/chat").to(data.room).emit("newMessage", data);
    });
  });
};
