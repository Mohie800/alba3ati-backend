const { ROUND_TIME, VOTE_TIME } = require("../../utils/constants");
const Room = require("../models/room.model");
const claculateResult = require("./calculate.game");
const { claculateVoteResult } = require("./claculateVoteResult.game");
const { startTimer } = require("./timer.game");
const { clearSkipVotes } = require("./skipDiscussion.game");

// Start a separate voting timer instead of counting votes immediately
const startVotingPhase = async (io, roomId) => {
  clearSkipVotes(roomId);
  startTimer(io, VOTE_TIME, roomId, "votingTimeUp", claculateVoteResult);
};

module.exports.nightResults = async (io, roomId, voted) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (voted) {
      room.roundNumber = room.roundNumber + 1;
      room.players
        .filter((p) => p.status === "alive")
        .forEach((p) => (p.night = p.night + 1));
    }
    const alivePlayers = room.players.filter((p) => p.status === "alive");
    await room.save();
    const ba3atiCount = alivePlayers.filter((p) => p.roleId === "1").length;
    const abuJanzeerCount = alivePlayers.filter((p) => p.roleId === "5").length;
    const villagersCount = alivePlayers.filter(
      (p) => p.roleId !== "1" && p.roleId !== "5",
    ).length;
    if (alivePlayers.length === 1 && abuJanzeerCount === 1) {
      // abu janzeer wins 3
      io.to(roomId).emit("gameOver", { room, win: "3" });
    } else if (
      ba3atiCount > 0 &&
      ba3atiCount > villagersCount + abuJanzeerCount
    ) {
      // ba3ati wins 1
      io.to(roomId).emit("gameOver", { room, win: "1" });
    } else if (
      villagersCount > 0 &&
      ba3atiCount === 0 &&
      abuJanzeerCount === 0
    ) {
      // villagers win 2
      io.to(roomId).emit("gameOver", { room, win: "2" });
    } else if (alivePlayers.length === 0) {
      io.to(roomId).emit("gameOver", { room, win: "0" });
      // draw 0
    } else {
      // continue to the next night with the updated room status and players' statuses
      if (voted) {
        io.to(roomId).emit("nextNight", room);
        startTimer(
          io,
          ROUND_TIME,
          roomId,
          "timerEnd",
          claculateResult.claculateResult,
        );
      } else {
        startTimer(
          io,
          room.discussionTime,
          roomId,
          "timerEnds",
          startVotingPhase,
        );
      }
      return true;
    }
    return false; // return false if the game is not over yet (not all players are dead)
  } catch (error) {
    console.error(error);
    return false; // return false if there is an error while calculating the game result
  }
};
