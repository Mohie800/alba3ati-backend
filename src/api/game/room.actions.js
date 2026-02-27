const { ROLES } = require("../../utils/constants");
const { getActiveRooms } = require("../controllers/room.controller");
const Room = require("../models/room.model");
const { claculateResult } = require("./calculate.game");

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

const resoveAction = async (roomId, io, socket) => {
  const room = await Room.findOne({ roomId }).populate("players.player");
  if (!room) return;
  const notDone = room.players.find(
    (p) => p.playStatus === "playing" && p.status === "alive"
  );
  if (!notDone) {
    io.to(roomId).emit("playerDone", room);
    claculateResult(io, roomId);
  } else {
    io.to(roomId).emit("playerDone", room);
    socket.emit("waitRoom");
  }
};

// Query helper: $elemMatch ensures all conditions match the SAME array element
const playerElemMatch = (roomId, playerId) => ({
  roomId,
  players: {
    $elemMatch: { player: playerId, playStatus: "playing", status: "alive" },
  },
});

exports.al3omdaAction = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    // Cannot protect the same player two nights in a row (per al3omda)
    const myLastTarget = room.lastAl3omdaTargets && room.lastAl3omdaTargets.get
      ? room.lastAl3omdaTargets.get(playerId)
      : null;
    if (myLastTarget && myLastTarget === targetId) {
      socket.emit("actionError", { message: "لا يمكنك حماية نفس اللاعب ليلتين متتاليتين" });
      return;
    }

    // Validate target is alive and in the room
    const targetPlayer = room.players.find((p) => p.player._id.toString() === targetId);
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push target
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: { al3omdaTargets: { player: playerId, target: targetId } },
      },
      { new: true }
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket);
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

    // Validate target is alive and in the room
    const targetPlayer = room.players.find((p) => p.player._id.toString() === targetId);
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push target
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: { ba3atiTargets: { player: playerId, target: targetId } },
      },
      { new: true }
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.damazeenAction = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    // Damazeen can only attack once per game
    if (room.damazeenAttackUsedBy.includes(playerId)) {
      socket.emit("actionError", { message: "لقد استخدمت الهجوم بالفعل" });
      return;
    }

    // Validate target is alive and in the room
    const targetPlayer = room.players.find((p) => p.player._id.toString() === targetId);
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push targets
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: {
          damazeenTargets: { player: playerId, target: targetId },
          damazeenAttackUsedBy: playerId,
        },
      },
      { new: true }
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.damazeenProtection = async (io, socket, { roomId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    // Damazeen can only protect once per game
    if (room.damazeenProtectUsedBy.includes(playerId)) {
      socket.emit("actionError", { message: "لقد استخدمت الحماية بالفعل" });
      return;
    }

    // Atomically update player status and set protection
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", damazeenProtection: true },
        $push: { damazeenProtectUsedBy: playerId },
      },
      { new: true }
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.sitAlwada3Action = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    // Validate target is alive and in the room
    const targetPlayer = room.players.find((p) => p.player._id.toString() === targetId);
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Privately reveal the target's role to the requesting socket
    socket.emit("sitAlwada3Reveal", {
      targetId,
      targetName: targetPlayer.player.name,
      roleId: targetPlayer.roleId,
    });

    // Atomically update player status and push target
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: { sitAlwada3Targets: { player: playerId, target: targetId } },
      },
      { new: true }
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.abuJanzeerAction = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate("players.player");
    if (!room) return;

    // Validate target is alive and in the room
    const targetPlayer = room.players.find((p) => p.player._id.toString() === targetId);
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push target
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: { abuJanzeerTargets: { player: playerId, target: targetId } },
      },
      { new: true }
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.skipNightAction = async (io, socket, { roomId, playerId }) => {
  try {
    // Atomically mark player as done
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      { $set: { "players.$.playStatus": "done" } },
      { new: true }
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
