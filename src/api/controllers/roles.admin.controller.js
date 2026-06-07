const { ROLES, MANDATORY_ROLE_IDS } = require("../../utils/constants");
const RoleConfig = require("../models/roleConfig.model");

// Merge the hardcoded ROLES with their admin config, flagging mandatory
// (core) roles that the admin is not allowed to lock.
async function buildRoleList() {
  const configs = await RoleConfig.find();
  const byId = {};
  configs.forEach((c) => {
    byId[c.roleId] = c;
  });
  return ROLES.map((r) => {
    const cfg = byId[r.id];
    return {
      roleId: r.id,
      name: r.name,
      color: r.color,
      locked: cfg ? cfg.locked : false,
      price: cfg ? cfg.price : 0,
      mandatory: MANDATORY_ROLE_IDS.includes(r.id),
    };
  });
}

// GET /api/admin/roles — all roles with config for the admin dashboard.
exports.getRoles = async (req, res) => {
  try {
    const roles = await buildRoleList();
    res.json({ success: true, data: { roles } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// PUT /api/admin/roles/:roleId { locked, price } — upsert a role's config.
exports.updateRole = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { locked, price } = req.body;

    const roleDef = ROLES.find((r) => r.id === roleId);
    if (!roleDef) {
      return res
        .status(404)
        .json({ success: false, message: "Role not found" });
    }

    const wantLocked = !!locked;
    if (wantLocked && MANDATORY_ROLE_IDS.includes(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Core roles cannot be locked",
      });
    }

    const priceNum = Number(price);
    if (Number.isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({
        success: false,
        message: "price must be a non-negative number",
      });
    }

    // A locked role must be purchasable — it needs a positive price.
    if (wantLocked && priceNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Locked roles must have a price greater than 0",
      });
    }

    const config = await RoleConfig.findOneAndUpdate(
      { roleId },
      { locked: wantLocked, price: priceNum },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      data: {
        role: {
          roleId,
          name: roleDef.name,
          color: roleDef.color,
          locked: config.locked,
          price: config.price,
          mandatory: MANDATORY_ROLE_IDS.includes(roleId),
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
