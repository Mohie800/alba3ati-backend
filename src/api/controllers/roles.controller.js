const { ROLES, MANDATORY_ROLE_IDS } = require("../../utils/constants");
const RoleConfig = require("../models/roleConfig.model");
const User = require("../models/user.model");
const CoinTransaction = require("../models/coinTransaction.model");

// Merge the hardcoded ROLES with their admin config (locked/price). Roles
// without a RoleConfig document default to { locked: false, price: 0 }.
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
    };
  });
}

exports.buildRoleList = buildRoleList;

// GET /api/roles — public list of roles with lock/price metadata.
exports.getRoles = async (req, res) => {
  try {
    const roles = await buildRoleList();
    res.json({ success: true, data: { roles } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /api/roles/owned/:userId — the roles a user has unlocked.
exports.getOwnedRoles = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("ownedRoles");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    res.json({ success: true, data: { ownedRoles: user.ownedRoles || [] } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// POST /api/roles/purchase { userId, roleId } — buy a locked role with coins.
exports.purchaseRole = async (req, res) => {
  try {
    const { userId, roleId } = req.body;
    if (!userId || !roleId) {
      return res
        .status(400)
        .json({ success: false, message: "userId and roleId required" });
    }

    // Must be a real game role.
    const roleDef = ROLES.find((r) => r.id === roleId);
    if (!roleDef) {
      return res.status(404).json({ success: false, error: "role_not_found" });
    }

    // Core roles are never sellable, even if a stale config marks one locked.
    if (MANDATORY_ROLE_IDS.includes(roleId)) {
      return res.status(400).json({ success: false, error: "not_purchasable" });
    }

    // Only locked, priced roles are purchasable.
    const config = await RoleConfig.findOne({ roleId });
    if (!config || !config.locked || !(config.price > 0)) {
      return res.status(400).json({ success: false, error: "not_purchasable" });
    }

    const price = config.price;

    // Atomic purchase: check balance >= price AND role not already owned.
    const result = await User.findOneAndUpdate(
      {
        _id: userId,
        coins: { $gte: price },
        ownedRoles: { $ne: roleId },
      },
      { $inc: { coins: -price }, $addToSet: { ownedRoles: roleId } },
      { new: true }
    );

    if (!result) {
      // Determine the specific failure.
      const user = await User.findById(userId).select("coins ownedRoles");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      if ((user.ownedRoles || []).includes(roleId)) {
        return res.status(400).json({ success: false, error: "already_owned" });
      }
      return res
        .status(400)
        .json({ success: false, error: "insufficient_coins" });
    }

    await CoinTransaction.create({
      user: userId,
      amount: -price,
      balance: result.coins,
      type: "role_purchase",
      meta: { roleId, price },
    });

    console.info(
      `[Roles] Role purchased: user=${userId} role=${roleId} price=${price}`
    );
    res.json({
      success: true,
      newBalance: result.coins,
      ownedRoles: result.ownedRoles,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
