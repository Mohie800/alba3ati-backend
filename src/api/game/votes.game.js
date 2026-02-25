const Room = require("../models/room.model");
const { claculateVoteResult } = require("./claculateVoteResult.game");

exports.voteSubmit = async (io, socket, { roomId, targetId, playerId }) => {
  const room = await Room.findOne({ roomId }).populate("players.player");
  const playerObj = room.players.find((p) => p.player._id == playerId);
  if (!playerObj) return;
  playerObj.playStatus = "done";
  room.votes.push(targetId);
  await room.save();
  const notDone = room.players.find(
    (p) => p.playStatus === "playing" && p.status === "alive"
  );
  io.to(roomId).emit("playerVoted", room);
  if (!notDone) {
    claculateVoteResult(io, roomId);
  }
  return;
};
