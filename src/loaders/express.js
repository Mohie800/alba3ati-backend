const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const config = require("../config/config");

module.exports = (app) => {
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve uploaded files
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Health check endpoint
  app.get("/health", (req, res) => res.sendStatus(200));
};
