const Room = require("../models/room.model");
const { cancelTimer, setPhase, startPhaseTimer } = require("./timer.game");
const { VOTE_RESULTS_TIME } = require("../../utils/constants");
const { PLAYER_POPULATE, findPlayer } = require("./roomUtils");

// Clears per-round action state for the next night.
const resetRoundState = (room) => {
  room.players.forEach((P) => {
    P.playStatus = "playing";
  });
  room.votes = [];
  room.al3omdaTargets = [];
  room.ba3atiTargets = [];
  room.damazeenTargets = [];
  room.sitAlwada3Targets = [];
  room.abuJanzeerTargets = [];
  room.ballahTargets = [];
  room.ba3atiKabeerTargets = [];
  room.ba3atiKabeerConvertTargets = [];
  room.jenabuTargets = [];
  room.wadAlzalatTargets = [];
  room.damazeenProtection = false;
  room.skipVotes = [];
  room.mutedPlayers = [];
};

// Resolves the vote. Runs under the room lock; the phase guard makes a second
// trigger (vote timer racing the last vote) a no-op.
exports.claculateVoteResult = async (io, roomId) => {
  const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
  if (!room || room.status !== "playing" || room.gamePhase !== "voting") {
    return null;
  }
  cancelTimer(roomId);
  io.to(roomId).emit("stopTimer");

  // Only votes for players still alive count; anything else is ignored.
  const voteCounts = {};
  room.votes.forEach((votedPlayerId) => {
    const target = findPlayer(room, votedPlayerId);
    if (!target || target.status !== "alive") return;
    voteCounts[votedPlayerId] = (voteCounts[votedPlayerId] || 0) + 1;
  });

  const maxVotes = Math.max(...Object.values(voteCounts), 0);
  const potentialEliminated = Object.entries(voteCounts)
    .filter(([_, count]) => count === maxVotes)
    .map(([playerId]) => playerId);

  let eliminated = null;
  if (potentialEliminated.length === 1) {
    const eliminatedPlayer = findPlayer(room, potentialEliminated[0]);
    if (eliminatedPlayer) {
      eliminatedPlayer.status = "dead";
      eliminated = potentialEliminated[0];
    }
  }

  setPhase(room, "voteResults", VOTE_RESULTS_TIME);
  // Clients get this round's votes; the saved room is already reset for the
  // next night (one save, so a crash can't leave a half-reset round).
  const snapshot = room.toJSON();
  resetRoundState(room);
  await room.save();

  io.to(roomId).emit("vote-res", { room: snapshot, eliminated });
  startPhaseTimer(io, room);
  return null;
};
