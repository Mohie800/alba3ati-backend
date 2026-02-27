const Room = require("../models/room.model");
const { nightResults } = require("./results.game");
const { cancelTimer } = require("./timer.game");
module.exports.claculateResult = async (io, roomId) => {
  try {
    // Fetch the room
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return null;

    // Snapshot who is alive BEFORE kill resolution
    const wasAlive = {};
    room.players.forEach((p) => {
      wasAlive[p.player._id.toString()] = p.status;
    });

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

    // Snapshot after ba3ati/damazeen kills, before abuJanzeer
    const beforeAbuJanzeer = {};
    room.players.forEach((p) => {
      beforeAbuJanzeer[p.player._id.toString()] = p.status;
    });

    // Abu Janzeer kills — unblockable (not affected by omda or damazeen protection)
    const abuJanzeerTargets = room.abuJanzeerTargets.map((t) => t.target);
    room.players.forEach((player) => {
      if (player.status === "dead") return;
      if (abuJanzeerTargets.includes(player.player._id.toString())) {
        player.status = "dead";
      }
    });

    // Determine who died from ba3ati/damazeen (regular deaths)
    const newlyDead = room.players
      .filter(
        (p) =>
          wasAlive[p.player._id.toString()] === "alive" &&
          beforeAbuJanzeer[p.player._id.toString()] === "dead"
      )
      .map((p) => p.player._id.toString());

    // Determine who died from abuJanzeer (separate list)
    const abuJanzeerDead = room.players
      .filter(
        (p) =>
          beforeAbuJanzeer[p.player._id.toString()] === "alive" &&
          p.status === "dead"
      )
      .map((p) => p.player._id.toString());

    // Remember each al3omda's target this night (for next-round restriction)
    const newLastTargets = {};
    room.al3omdaTargets.forEach((t) => {
      newLastTargets[t.player] = t.target;
    });
    room.lastAl3omdaTargets = newLastTargets;

    // Save the updated room
    room.players.forEach((P) => {
      P.playStatus = "playing";
    });
    await room.save();
    io.to(roomId).emit("timeout", { room, newlyDead, abuJanzeerDead });
    cancelTimer(roomId);
    io.to(roomId).emit("stopTimer");
    setTimeout(() => nightResults(io, roomId), 3000);

    return room; // Return the updated room
  } catch (error) {
    console.error("Error updating player status:", error);
    return null;
  }
};
