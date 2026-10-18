const { ROUND_TIME, MANDATORY_ROLE_IDS } = require("../../utils/constants");
const Room = require("../models/room.model");
const RoleConfig = require("../models/roleConfig.model");
const User = require("../models/user.model");
const { setPhase, startPhaseTimer } = require("./timer.game");
const { withRoomLock } = require("./roomLock");
const { PLAYER_POPULATE } = require("./roomUtils");

exports.assignRoles = (io, socket, arg) => {
  const roomId = arg && arg.roomId;
  if (!roomId) return;
  return withRoomLock(roomId, () => assignRolesLocked(io, socket, arg));
};

const assignRolesLocked = async (
  io,
  socket,
  { roomId, distribution, discussionTime, votesVisible, deadChat }
) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Roles are dealt once per game; a repeated emit must not reshuffle.
    if (room.status !== "playing" || room.gamePhase !== "roleSetup") return;

    // Only the host configures the role distribution.
    if (socket.playerId && room.host && socket.playerId !== room.host) return;

    // Counts come from the client: reject anything that isn't a small
    // non-negative integer, or that leaves a player without a role.
    // Entries of deleted users (null) are hidden from clients, so they are
    // neither counted nor dealt a role.
    const realPlayers = room.players.filter((p) => p.player);
    const counts = Object.values(distribution || {});
    const total = counts.reduce((sum, c) => sum + (Number(c) || 0), 0);
    if (
      counts.some((c) => !Number.isInteger(c) || c < 0) ||
      total < realPlayers.length ||
      total > realPlayers.length * 2
    ) {
      socket.emit("assignmentError", { message: "توزيع الأدوار غير صالح" });
      return;
    }

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
    const shuffledPlayers = shuffleArray([...realPlayers]);
    shuffledPlayers.forEach((player, index) => {
      // Assign the role from rolePool to the player's roleId
      player.roleId = rolePool[index];
    });

    // Update room with assignments
    setPhase(room, "night", ROUND_TIME);
    await room.save();
    startPhaseTimer(io, room);

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
