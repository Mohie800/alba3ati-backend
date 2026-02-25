module.exports = (io) => {
  io.of("/chat").on("connection", (socket) => {
    console.log("User connected to chat namespace");

    socket.on("joinRoom", (room) => {
      socket.join(room);
    });

    socket.on("sendMessage", (data) => {
      io.of("/chat").to(data.room).emit("newMessage", data);
    });
  });
};
