const { ROUND_TIME } = require("../../utils/constants");
const Room = require("../models/room.model");
const { claculateResult } = require("./calculate.game");
const { startTimer } = require("./timer.game");
exports.assignRoles = async (
  io,
  socket,
  { roomId, distribution, discussionTime }
) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    room.discussionTime = discussionTime * 60;
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
