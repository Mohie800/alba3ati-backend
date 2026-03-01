const express = require("express");
const http = require("http");
const config = require("./config/config");
const expressLoader = require("./loaders/express");
const mongooseLoader = require("./loaders/mongoose");
const socketioLoader = require("./loaders/socket.io");

const startServer = async () => {
  const app = express();
  const server = http.createServer(app);

  // Loaders
  expressLoader(app);
  await mongooseLoader();
  const io = socketioLoader(server);
  app.set("io", io);

  // Routes
  app.use("/api", require("./api/routes"));

  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  });

  server.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
};

startServer();
