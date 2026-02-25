const { ROLES } = require("../../utils/constants");
const { getActiveRooms } = require("../controllers/room.controller");
const Room = require("../models/room.model");
const { claculateResult } = require("./calculate.game");

const resetPlayingStatus = async (roomId) => {
  try {
    const room = await Room.findOne({ roomId });
    room.players.forEach((P) => {
      P.playStatus = "playing";
    });
    room.votes = [];
    await room.save();
    console.log(room);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};

exports.startGame = async (io, socket, { roomId }) => {
  try {
    const room = await Room.findOne({ roomId });
    if (!room) return;
    if (room.players.length <= 1) {
      socket.emit("startGameError", { message: "عدد اللاعبين غير كافي" });
      return;
    }
    socket.emit("gameStarted");
    room.status = "playing";
    await room.save();
    const rooms = await getActiveRooms();
    io.emit("roomsUpdate", rooms);
  } catch (error) {
    console.log(error);
    return;
  }
};

const resoveAction = (room, roomId, io, socket) => {
  const notDone = room.players.find(
    (p) => p.playStatus === "playing" && p.status === "alive"
  );
  console.log(notDone);
  if (!notDone) {
    io.to(roomId).emit("playerDone", room);
    claculateResult(io, roomId);
  } else {
    io.to(roomId).emit("playerDone", room);
    socket.emit("waitRoom");
    //I want to emit the updated room here, please help me
  }
};

exports.al3omdaAction = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;
    const playerObj = room.players.find((p) => p.player._id == playerId);
    if (!playerObj) return;
    playerObj.target = targetId;
    playerObj.playStatus = "done";

    room.al3omdaTargets.push({ player: playerId, target: targetId });
    await room.save();

    resoveAction(room, roomId, io, socket);
    return null;
  } catch (error) {
    console.log(error);
    return;
  }
};

exports.ba3atiAction = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    const playerObj = room.players.find((p) => p.player._id == playerId);

    if (!playerObj) return;
    playerObj.target = targetId;
    playerObj.playStatus = "done";

    room.ba3atiTargets.push({ player: playerId, target: targetId });
    await room.save();
    resoveAction(room, roomId, io, socket);
    return;
  } catch (error) {
    console.log(error);
    return;
    // socket.emit("assignmentError", { message: "Failed to assign roles" });
  }
};
exports.damazeenAction = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    const playerObj = room.players.find((p) => p.player._id == playerId);

    if (!playerObj) return;
    playerObj.target = targetId;
    playerObj.playStatus = "done";

    room.damazeenTargets.push({ player: playerId, target: targetId });
    await room.save();
    resoveAction(room, roomId, io, socket);
    return;
  } catch (error) {
    console.log(error);
    return;
    // socket.emit("assignmentError", { message: "Failed to assign roles" });
  }
};
exports.damazeenProtection = async (io, socket, { roomId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    const playerObj = room.players.find((p) => p.player._id == playerId);

    if (!playerObj) return;
    playerObj.playStatus = "done";

    room.damazeenProtection = true;
    await room.save();
    resoveAction(room, roomId, io, socket);
    return;
  } catch (error) {
    console.log(error);
    return;
    // socket.emit("assignmentError", { message: "Failed to assign roles" });
  }
};
