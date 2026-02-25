const Room = require("../models/room.model");
const { nightResults } = require("./results.game");
const { startTimer } = require("./timer.game");
module.exports.claculateResult = async (io, roomId) => {
  try {
    // Fetch the room
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return null;

    // Extract player IDs from ba3atiTargets and al3omdaTargets
    const ba3atiTargets = room.ba3atiTargets.map((t) => t.target);
    const al3omdatargets = new Set(room.al3omdaTargets.map((t) => t.target)); // Use a Set for fast lookup

    // Update players in ba3atiTargets but not in al3omdaTargets
    console.log(room.damazeenProtection);
    if (!room.damazeenProtection) {
      room.players.forEach((player) => {
        if (player.status === "dead") return;
        if (
          ba3atiTargets.includes(player.player._id.toString()) &&
          !al3omdatargets.has(player.player._id.toString())
        ) {
          player.status = "dead"; // Mark as dead
        }
      });
    }

    //damazeen action
    const damazeenTargets = room.damazeenTargets.map((t) => t.target);
    room.players.forEach((player) => {
      if (player.status === "dead") return;
      if (damazeenTargets.includes(player.player._id.toString())) {
        player.status = "dead"; // Mark as dead
      }
    });

    // Save the updated room

    room.players.forEach((P) => {
      P.playStatus = "playing";
    });
    await room.save();
    io.to(roomId).emit("timeout", room);
    startTimer(io, 1, roomId, "stopTimer");
    setTimeout(() => nightResults(io, roomId), 3000);

    return room; // Return the updated room
  } catch (error) {
    console.error("Error updating player status:", error);
    return null;
  }
};
