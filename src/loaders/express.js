const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const config = require("../config/config");

module.exports = (app) => {
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get("/health", (req, res) => res.sendStatus(200));
};
