const Room = require("../models/room.model");
const { claculateVoteResult } = require("./claculateVoteResult.game");

exports.voteSubmit = async (io, socket, { roomId, targetId, playerId }) => {
  // Atomically mark player as done and push vote
  const updated = await Room.findOneAndUpdate(
    {
      roomId,
      players: {
        $elemMatch: { player: playerId, playStatus: "playing", status: "alive" },
      },
    },
    {
      $set: { "players.$.playStatus": "done" },
      $push: { votes: targetId },
    },
    { new: true }
  ).populate("players.player");
  if (!updated) return;

  const notDone = updated.players.find(
    (p) => p.playStatus === "playing" && p.status === "alive"
  );
  io.to(roomId).emit("playerVoted", updated);
  if (!notDone) {
    claculateVoteResult(io, roomId);
  }
  return;
};
