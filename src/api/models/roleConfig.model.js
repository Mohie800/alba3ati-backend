const mongoose = require("mongoose");

// Per-role admin configuration layered on top of the hardcoded ROLES
// constant. A role is only represented here once an admin has configured it;
// any role without a document is treated as { locked: false, price: 0 }.
const roleConfigSchema = new mongoose.Schema(
  {
    roleId: { type: String, required: true, unique: true },
    locked: { type: Boolean, default: false },
    price: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RoleConfig", roleConfigSchema);
