const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const config = require("../config/config");

module.exports = (app) => {
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // Rate limiting for API routes (keyed by userId to avoid shared-IP collisions on mobile carriers)
  app.use(
    "/api",
    rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      keyGenerator: (req) => {
        // Try body.userId (POST requests), then extract userId from URL path segments (GET requests like /api/friends/list/:userId)
        if (req.body?.userId) return req.body.userId;
        // Match MongoDB ObjectId pattern in path (24 hex chars)
        const match = req.path.match(/\/([a-f0-9]{24})(?:\/|$)/);
        if (match) return match[1];
        return req.ip;
      },
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // Serve uploaded files
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Health check endpoint
  app.get("/health", (req, res) => res.sendStatus(200));
};
