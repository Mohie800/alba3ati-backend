const Room = require("../models/room.model");
const res = require("./results.game");
const { startTimer } = require("./timer.game");
const resetPlayingStatus = async (roomId) => {
  try {
    const room = await Room.findOne({ roomId });
    room.players.forEach((P) => {
      P.playStatus = "playing";
    });
    room.votes = [];
    room.al3omdaTargets = [];
    room.ba3atiTargets = [];
    room.damazeenTargets = [];
    room.damazeenProtection = false;
    await room.save();
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.claculateVoteResult = async (io, roomId) => {
  //stop timer
  startTimer(io, 1, roomId, "stop");
  // Fetch the room
  const room = await Room.findOne({ roomId }).populate("players.player");
  if (!room) return null;
  const voteCounts = {};

  room.votes.forEach((votedPlayerId) => {
    voteCounts[votedPlayerId] = (voteCounts[votedPlayerId] || 0) + 1;
  });

  const maxVotes = Math.max(...Object.values(voteCounts), 0);
  const potentialEliminated = Object.entries(voteCounts)
    .filter(([_, count]) => count === maxVotes)
    .map(([playerId]) => playerId);

  // Handle tie scenario
  const isTie = potentialEliminated.length > 1;

  if (isTie || potentialEliminated.length === 0) {
    // Emit a message to the room
    io.to(roomId).emit("vote-res", { room, eliminated: null });
  } else {
    const eliminatedPlayer = room.players.find(
      (p) => p.player._id == potentialEliminated[0]
    );
    if (!eliminatedPlayer) return;
    eliminatedPlayer.status = "dead";
    await room.save();
    io.to(roomId).emit("vote-res", {
      room,
      eliminated: potentialEliminated[0],
    });
  }
  resetPlayingStatus(roomId);
  setTimeout(() => {
    res.nightResults(io, roomId, true);
  }, 5000);
  return;
};
