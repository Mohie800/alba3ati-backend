const { ROUND_TIME, DIS_DUE } = require("../../utils/constants");
const Room = require("../models/room.model");
const claculateResult = require("./calculate.game");
const { claculateVoteResult } = require("./claculateVoteResult.game");
const { startTimer } = require("./timer.game");

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
    const villagersCount = alivePlayers.filter((p) => p.roleId !== "1").length;
    if (ba3atiCount > villagersCount) {
      // ba3ati wins 1
      io.to(roomId).emit("gameOver", { room, win: "1" });
    } else if (villagersCount > 0 && ba3atiCount === 0) {
      // villagers win 2
      console.log(roomId);
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
          claculateResult.claculateResult
        );
      } else {
        startTimer(
          io,
          room.discussionTime,
          roomId,
          "timerEnds",
          claculateVoteResult
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
