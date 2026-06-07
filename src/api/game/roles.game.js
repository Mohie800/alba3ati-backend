const { ROUND_TIME, MANDATORY_ROLE_IDS } = require("../../utils/constants");
const Room = require("../models/room.model");
const RoleConfig = require("../models/roleConfig.model");
const User = require("../models/user.model");
const { claculateResult } = require("./calculate.game");
const { startTimer } = require("./timer.game");
exports.assignRoles = async (
  io,
  socket,
  { roomId, distribution, discussionTime, votesVisible, deadChat }
) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    // Only the host configures the role distribution.
    if (socket.playerId && room.host && socket.playerId !== room.host) return;

    // Locked-role gate: a locked role may only be put into play if the HOST
    // owns it. Mandatory core roles are always allowed. Once allowed, the role
    // can be assigned to any player. Rooms with no locked roles skip this.
    const lockedCfgs = await RoleConfig.find({ locked: true }).select("roleId");
    if (lockedCfgs.length) {
      const lockedSet = new Set(lockedCfgs.map((c) => c.roleId));
      const selectedLocked = Object.entries(distribution || {})
        .filter(
          ([rid, count]) =>
            count > 0 &&
            lockedSet.has(rid) &&
            !MANDATORY_ROLE_IDS.includes(rid)
        )
        .map(([rid]) => rid);
      if (selectedLocked.length) {
        const hostUser = await User.findById(room.host).select("ownedRoles");
        const owned = new Set(hostUser?.ownedRoles || []);
        const missing = selectedLocked.filter((rid) => !owned.has(rid));
        if (missing.length) {
          socket.emit("assignmentError", {
            message: "لا تملك أحد الأدوار المقفلة المختارة",
          });
          return;
        }
      }
    }

    room.discussionTime = discussionTime * 60;
    room.votesVisible = votesVisible;
    room.deadChat = !!deadChat;
    // Create role array based on distribution
    const rolePool = [];
    Object.entries(distribution).forEach(([roleId, count]) => {
      rolePool.push(...Array(count).fill(roleId));
    });

    // Shuffle players and assign roles
    const shuffledPlayers = shuffleArray([...room.players]);
    shuffledPlayers.forEach((player, index) => {
      // Assign the role from rolePool to the player's roleId
      player.roleId = rolePool[index];
    });

    // Update room with assignments
    room.gamePhase = "night";
    await room.save();
    startTimer(io, ROUND_TIME, roomId, "timerEnd", claculateResult);

    // Notify all players
    io.to(roomId).emit("rolesAssigned", {
      // assignments: assignments.map((a) => ({
      //   playerId: a.playerId,
      //   role: ROLES.find((r) => r.id === a.roleId),
      // })),
      room: room,
    });
  } catch (error) {
    console.log(error);
    socket.emit("assignmentError", { message: "Failed to assign roles" });
  }
};

// Helper function to shuffle array
const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};
