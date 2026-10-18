const Room = require("../models/room.model");
const { claculateVoteResult } = require("./claculateVoteResult.game");
const { withRoomLock } = require("./roomLock");
const { PLAYER_POPULATE, findPlayer } = require("./roomUtils");

// Matches only an alive voter who hasn't voted yet, during the voting phase.
const voterFilter = (roomId, playerId) => ({
  roomId,
  status: "playing",
  gamePhase: "voting",
  players: {
    $elemMatch: { player: playerId, playStatus: "playing", status: "alive" },
  },
});

const afterVote = async (io, roomId, updated) => {
  await updated.populate(PLAYER_POPULATE);
  const notDone = updated.players.find(
    (p) => p.playStatus === "playing" && p.status === "alive",
  );
  io.to(roomId).emit("playerVoted", updated);
  if (!notDone) {
    await claculateVoteResult(io, roomId);
  }
};

exports.voteSubmit = (io, socket, { roomId, targetId, playerId } = {}) => {
  if (!roomId || !targetId || !playerId) return;
  return withRoomLock(roomId, async () => {
    try {
      const room = await Room.findOne({ roomId }, "players status gamePhase");
      if (!room || room.status !== "playing" || room.gamePhase !== "voting") return;
      const target = findPlayer(room, targetId);
      if (!target || target.status !== "alive") return;

      const updated = await Room.findOneAndUpdate(
        voterFilter(roomId, playerId),
        {
          $set: { "players.$.playStatus": "done" },
          $push: { votes: String(targetId) },
        },
        { new: true },
      );
      if (!updated) return;
      await afterVote(io, roomId, updated);
    } catch (error) {
      console.error("[vote] error:", error);
    }
  });
};

exports.voteSkip = (io, socket, { roomId, playerId } = {}) => {
  if (!roomId || !playerId) return;
  return withRoomLock(roomId, async () => {
    try {
      const updated = await Room.findOneAndUpdate(
        voterFilter(roomId, playerId),
        { $set: { "players.$.playStatus": "done" } },
        { new: true },
      );
      if (!updated) return;
      await afterVote(io, roomId, updated);
    } catch (error) {
      console.error("[skipVote] error:", error);
    }
  });
};
