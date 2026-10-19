const { ROUND_TIME } = require("../../utils/constants");
const Room = require("../models/room.model");
const { setPhase, startPhaseTimer, cancelTimer } = require("./timer.game");
const { advanceToVoting } = require("./skipDiscussion.game");
const { getRoleDeclarations } = require("./declareRole.game");
const { updatePlayerStats } = require("./statsUpdate.game");
const { recordGameEnd } = require("./dailyStats.game");
const { PLAYER_POPULATE } = require("./roomUtils");

// Discussion timer expired. The timer already emitted "timerEnds".
const startVotingPhase = async (io, roomId) => {
  const room = await Room.findOne({ roomId });
  if (!room || room.status !== "playing" || room.gamePhase !== "discussion") return;
  await advanceToVoting(io, room, { emitTimerEnds: false });
};

// Winner per the alive players, or null if the game goes on.
const decideWinner = (alivePlayers) => {
  const ba3atiCount = alivePlayers.filter(
    (p) => p.roleId === "1" || p.roleId === "7",
  ).length;
  const abuJanzeerCount = alivePlayers.filter((p) => p.roleId === "5").length;
  const villagersCount = alivePlayers.filter(
    (p) => p.roleId !== "1" && p.roleId !== "5" && p.roleId !== "7",
  ).length;
  if (alivePlayers.length === 1 && abuJanzeerCount === 1) return "3"; // abu janzeer
  if (ba3atiCount > 0 && ba3atiCount > villagersCount + abuJanzeerCount) return "1"; // ba3ati
  if (villagersCount > 0 && ba3atiCount === 0 && abuJanzeerCount === 0) return "2"; // villagers
  if (alivePlayers.length === 0) return "0"; // draw
  return null;
};

// Runs under the room lock after night results (voted=false) or vote results
// (voted=true); the phase guard drops duplicate or stale calls. Every outcome
// is one save, so a crash can't apply the round increment twice.
const nightResults = async (io, roomId, voted) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room || room.status !== "playing") return false;
    if (room.gamePhase !== (voted ? "voteResults" : "nightResults")) return false;
    if (voted) {
      room.roundNumber = room.roundNumber + 1;
      room.players
        .filter((p) => p.status === "alive")
        .forEach((p) => (p.night = p.night + 1));
    }
    const alivePlayers = room.players.filter((p) => p.status === "alive");
    const win = decideWinner(alivePlayers);

    if (win) {
      cancelTimer(roomId);
      setPhase(room, "gameOver");
      room.gameResult = win;
      room.gamesCompleted = (room.gamesCompleted || 0) + 1;
      room.gameHistory.push({
        result: win,
        endedAt: new Date(),
        playerCount: room.players.filter((p) => p.player).length,
        rounds: room.roundNumber,
      });
      if (room.gameHistory.length > 50) room.gameHistory.splice(0, room.gameHistory.length - 50);
      await room.save();
      const coinRewards = await updatePlayerStats(room, win);
      recordGameEnd(room, win);
      io.to(roomId).emit("gameOver", { room, win, coinRewards });
      return false;
    }

    // continue to the next night with the updated room status and players' statuses
    if (voted) {
      setPhase(room, "night", ROUND_TIME);
      await room.save();
      io.to(roomId).emit("nextNight", room);
      startPhaseTimer(io, room);
    } else {
      setPhase(room, "discussion", room.discussionTime);
      await room.save();
      io.to(roomId).emit("roleDeclarationsSync", {
        declarations: getRoleDeclarations(room),
      });
      startPhaseTimer(io, room);
    }
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};

module.exports = { nightResults, startVotingPhase };
