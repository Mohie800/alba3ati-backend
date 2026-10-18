const express = require("express");
const http = require("http");
const config = require("./config/config");
const expressLoader = require("./loaders/express");
const mongooseLoader = require("./loaders/mongoose");
const socketioLoader = require("./loaders/socket.io");
const { recoverActiveRooms } = require("./api/game/recovery.game");
const { waitForIdle } = require("./api/game/roomLock");

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

  // Resume games from the previous run before anyone can reconnect.
  try {
    await recoverActiveRooms(io);
  } catch (err) {
    console.error("[Recovery] failed:", err);
  }

  server.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });

  // PM2 stop/restart: let in-flight room updates finish, then exit without
  // running leave logic, so the next start resumes every game.
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    io.shuttingDown = true;
    console.log(`[Shutdown] ${signal}: draining room work`);
    await waitForIdle(1200);
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

startServer();
