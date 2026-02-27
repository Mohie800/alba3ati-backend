const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const config = require("../config/config");
const Admin = require("../api/models/admin.model");

async function seedAdmin() {
  try {
    await mongoose.connect(config.mongo.uri);
    console.log("Connected to MongoDB");

    const existing = await Admin.findOne({ username: "admin" });
    if (existing) {
      console.log("Admin user already exists, skipping seed.");
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash("admin123", 10);
    await Admin.create({ username: "admin", passwordHash });

    console.log("Admin user created successfully (username: admin, password: admin123)");
    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exit(1);
  }
}

seedAdmin();
