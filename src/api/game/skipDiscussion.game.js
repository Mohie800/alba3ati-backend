const Room = require("../models/room.model");
const { startTimer, cancelTimer } = require("./timer.game");
const { VOTE_TIME } = require("../../utils/constants");
const { isPlayerInGracePeriod } = require("./disconnect.game");

// In-memory store for skip votes per room
const skipVotes = new Map(); // roomId -> Set of playerIds

exports.skipDiscussionVote = async (io, socket, { roomId, playerId }, ack) => {
  const sendAck = (payload) => {
    if (typeof ack === "function") ack(payload);
  };
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) {
      sendAck({ ok: false, reason: "room_not_found" });
      return;
    }

    const player = room.players.find((p) => p.player._id == playerId);
    if (!player || player.status !== "alive") {
      sendAck({ ok: false, reason: "not_alive" });
      return;
    }

    // Initialize set for this room if needed
    if (!skipVotes.has(roomId)) {
      skipVotes.set(roomId, new Set());
    }

    const votes = skipVotes.get(roomId);
    votes.add(playerId);

    // Exclude disconnected (grace period) players from alive count
    const aliveCount = room.players.filter(
      (p) =>
        p.status === "alive" &&
        !isPlayerInGracePeriod(p.player._id.toString())
    ).length;
    const skipCount = votes.size;
    const votedPlayers = Array.from(votes);

    // Broadcast updated skip vote count
    io.to(roomId).emit("skipDiscussionUpdate", {
      skipCount,
      aliveCount,
      votedPlayers,
    });

    // Ack the caller with authoritative state so an optimistic client UI can
    // reconcile (confirm its skip landed, or self-correct if it didn't).
    sendAck({ ok: true, skipped: true, skipCount, aliveCount, votedPlayers });

    // If all alive players voted to skip, end discussion and start voting
    if (skipCount >= aliveCount) {
      cancelTimer(roomId);
      skipVotes.delete(roomId);
      room.gamePhase = "voting";
      await room.save();
      io.to(roomId).emit("timerEnds");

      // Start a voting timer so the game doesn't hang if not all players vote
      // Lazy require to avoid circular dependency with claculateVoteResult.game.js
      const { claculateVoteResult } = require("./claculateVoteResult.game");
      startTimer(io, VOTE_TIME, roomId, "votingTimeUp", claculateVoteResult);
    }
  } catch (error) {
    console.error("skipDiscussion error:", error);
    sendAck({ ok: false, reason: "error" });
  }
};

// Snapshot the current skip-discussion state for a room (used to resync a
// reconnecting player/spectator). Mirrors the payload broadcast in
// skipDiscussionVote so the client sees the same counts it would live.
exports.getSkipState = (room) => {
  const votes = skipVotes.get(room.roomId) || new Set();
  const aliveCount = room.players.filter(
    (p) =>
      p.status === "alive" &&
      !isPlayerInGracePeriod(p.player._id.toString()),
  ).length;
  return {
    skipCount: votes.size,
    aliveCount,
    votedPlayers: Array.from(votes),
  };
};

exports.clearSkipVotes = (roomId) => {
  skipVotes.delete(roomId);
};

exports.removePlayerSkipVote = (roomId, playerId) => {
  const votes = skipVotes.get(roomId);
  if (votes) {
    votes.delete(playerId);
  }
};
