const Room = require("../models/room.model");
const { startTimer, cancelTimer } = require("./timer.game");
const { VOTE_TIME } = require("../../utils/constants");

// In-memory store for skip votes per room
const skipVotes = new Map(); // roomId -> Set of playerIds

exports.skipDiscussionVote = async (io, socket, { roomId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    const player = room.players.find((p) => p.player._id == playerId);
    if (!player || player.status !== "alive") return;

    // Initialize set for this room if needed
    if (!skipVotes.has(roomId)) {
      skipVotes.set(roomId, new Set());
    }

    const votes = skipVotes.get(roomId);
    votes.add(playerId);

    const aliveCount = room.players.filter((p) => p.status === "alive").length;
    const skipCount = votes.size;

    // Broadcast updated skip vote count
    io.to(roomId).emit("skipDiscussionUpdate", {
      skipCount,
      aliveCount,
      votedPlayers: Array.from(votes),
    });

    // If all alive players voted to skip, end discussion and start voting
    if (skipCount >= aliveCount) {
      cancelTimer(roomId);
      skipVotes.delete(roomId);
      io.to(roomId).emit("timerEnds");

      // Start a voting timer so the game doesn't hang if not all players vote
      // Lazy require to avoid circular dependency with claculateVoteResult.game.js
      const { claculateVoteResult } = require("./claculateVoteResult.game");
      startTimer(io, VOTE_TIME, roomId, "votingTimeUp", claculateVoteResult);
    }
  } catch (error) {
    console.error("skipDiscussion error:", error);
  }
};

exports.clearSkipVotes = (roomId) => {
  skipVotes.delete(roomId);
};
