const Room = require("../models/room.model");
const { cancelTimer, setPhase, startPhaseTimer } = require("./timer.game");
const { VOTE_TIME } = require("../../utils/constants");
const { isPlayerInGracePeriod } = require("./disconnect.game");
const { withRoomLock } = require("./roomLock");
const { PLAYER_POPULATE, pidOf, findPlayer } = require("./roomUtils");

// Alive players, excluding disconnected (grace period) ones.
const countAliveConnected = (room) =>
  room.players.filter(
    (p) => p.status === "alive" && !isPlayerInGracePeriod(pidOf(p), room.roomId),
  ).length;

/**
 * Discussion -> voting. Shared by the discussion timer and the skip vote so
 * both paths reset the same state. Must run under the room lock, with `room`
 * freshly loaded and in the discussion phase.
 */
const advanceToVoting = async (io, room, { emitTimerEnds = true } = {}) => {
  const roomId = room.roomId;
  cancelTimer(roomId);
  room.skipVotes = [];
  room.mutedPlayers = [];
  setPhase(room, "voting", VOTE_TIME);
  await room.save();
  if (emitTimerEnds) io.to(roomId).emit("timerEnds");
  startPhaseTimer(io, room);
};

// End discussion early once every alive, connected player has voted to skip.
const maybeEndDiscussion = async (io, room) => {
  if (room.status !== "playing" || room.gamePhase !== "discussion") return false;
  const votes = room.skipVotes || [];
  if (votes.length === 0) return false;
  const aliveCount = countAliveConnected(room);
  if (aliveCount === 0 || votes.length < aliveCount) return false;
  await advanceToVoting(io, room);
  return true;
};

exports.skipDiscussionVote = (io, socket, { roomId, playerId } = {}, ack) => {
  const sendAck = (payload) => {
    if (typeof ack === "function") ack(payload);
  };
  if (!roomId || !playerId) {
    sendAck({ ok: false, reason: "invalid_request" });
    return;
  }
  return withRoomLock(roomId, async () => {
    try {
      const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
      if (!room) {
        sendAck({ ok: false, reason: "room_not_found" });
        return;
      }
      if (room.status !== "playing" || room.gamePhase !== "discussion") {
        sendAck({ ok: false, reason: "wrong_phase" });
        return;
      }

      const player = findPlayer(room, playerId);
      if (!player || player.status !== "alive") {
        sendAck({ ok: false, reason: "not_alive" });
        return;
      }

      const id = String(playerId);
      if (!room.skipVotes.includes(id)) {
        room.skipVotes.push(id);
        await room.save();
      }

      const aliveCount = countAliveConnected(room);
      const votedPlayers = [...room.skipVotes];
      const skipCount = votedPlayers.length;

      io.to(roomId).emit("skipDiscussionUpdate", {
        skipCount,
        aliveCount,
        votedPlayers,
      });

      // Ack the caller with authoritative state so an optimistic client UI can
      // reconcile (confirm its skip landed, or self-correct if it didn't).
      sendAck({ ok: true, skipped: true, skipCount, aliveCount, votedPlayers });

      await maybeEndDiscussion(io, room);
    } catch (error) {
      console.error("skipDiscussion error:", error);
      sendAck({ ok: false, reason: "error" });
    }
  });
};

// Snapshot the current skip-discussion state for a room (used to resync a
// reconnecting player/spectator). Mirrors the payload broadcast in
// skipDiscussionVote so the client sees the same counts it would live.
exports.getSkipState = (room) => {
  const votes = room.skipVotes || [];
  return {
    skipCount: votes.length,
    aliveCount: countAliveConnected(room),
    votedPlayers: [...votes],
  };
};

// Drops a player's skip vote on the doc (caller saves).
exports.removePlayerSkipVote = (room, playerId) => {
  room.skipVotes = (room.skipVotes || []).filter((id) => id !== String(playerId));
};

exports.advanceToVoting = advanceToVoting;
exports.maybeEndDiscussion = maybeEndDiscussion;
