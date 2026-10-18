const Room = require("../models/room.model");
const { claculateResult } = require("./calculate.game");
const { withRoomLock } = require("./roomLock");
const { PLAYER_POPULATE, pidOf } = require("./roomUtils");
const { broadcastRoomsUpdate } = require("./roomsList");
const { setPhase } = require("./timer.game");

exports.startGame = async (io, socket, { roomId }) => {
  try {
    const room = await Room.findOne({ roomId });
    if (!room) return;
    // A repeated start (double tap) must not reset a game already running.
    if (room.status !== "waiting") return;
    if (
      room.players.length <= 4 &&
      room.host.toString() !== "69c9ab1a6631e3885a13ed49"
    ) {
      socket.emit("startGameError", { message: "عدد اللاعبين غير كافي" });
      return;
    }
    room.status = "playing";
    setPhase(room, "roleSetup");
    await room.save();
    broadcastRoomsUpdate(io);
    io.to(roomId).emit("gameStarted");
  } catch (error) {
    console.log(error);
    return;
  }
};

// `updated` is the room returned by the action's atomic update.
const resoveAction = async (roomId, io, socket, updated) => {
  await updated.populate(PLAYER_POPULATE);
  const notDone = updated.players.find(
    (p) => p.playStatus === "playing" && p.status === "alive",
  );
  io.to(roomId).emit("playerDone", updated);
  if (!notDone) {
    await claculateResult(io, roomId);
  } else {
    socket.emit("waitRoom");
  }
};

// Query helper: $elemMatch ensures all conditions match the SAME array element.
// Actions are only accepted during the night of a running game.
const playerElemMatch = (roomId, playerId) => ({
  roomId,
  status: "playing",
  gamePhase: "night",
  players: {
    $elemMatch: { player: playerId, playStatus: "playing", status: "alive" },
  },
});

exports.al3omdaAction = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Cannot protect the same player two nights in a row (per al3omda)
    const myLastTarget =
      room.lastAl3omdaTargets && room.lastAl3omdaTargets.get
        ? room.lastAl3omdaTargets.get(playerId)
        : null;
    if (myLastTarget && myLastTarget === targetId) {
      socket.emit("actionError", {
        message: "لا يمكنك حماية نفس اللاعب ليلتين متتاليتين",
      });
      return;
    }

    // Validate target is alive and in the room
    const targetPlayer = room.players.find(
      (p) => pidOf(p) === targetId,
    );
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push target
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: { al3omdaTargets: { player: playerId, target: targetId } },
      },
      { new: true },
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket, updated);
    return null;
  } catch (error) {
    console.log(error);
    return;
  }
};

exports.ba3atiAction = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Validate target is alive and in the room
    const targetPlayer = room.players.find(
      (p) => pidOf(p) === targetId,
    );
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push target
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: { ba3atiTargets: { player: playerId, target: targetId } },
      },
      { new: true },
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket, updated);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.damazeenAction = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Damazeen can only attack once per game
    if (room.damazeenAttackUsedBy.includes(playerId)) {
      socket.emit("actionError", { message: "لقد استخدمت الهجوم بالفعل" });
      return;
    }

    // Validate target is alive and in the room
    const targetPlayer = room.players.find(
      (p) => pidOf(p) === targetId,
    );
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
      { new: true },
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket, updated);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.damazeenProtection = async (io, socket, { roomId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
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
      { new: true },
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket, updated);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.sitAlwada3Action = async (
  io,
  socket,
  { roomId, targetId, playerId },
) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Validate target is alive and in the room
    const targetPlayer = room.players.find(
      (p) => pidOf(p) === targetId,
    );
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push target
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: { sitAlwada3Targets: { player: playerId, target: targetId } },
      },
      { new: true },
    );
    if (!updated) return;

    // Privately reveal the target's role, only once the action was accepted
    socket.emit("sitAlwada3Reveal", {
      targetId,
      targetName: targetPlayer.player.name,
      roleId: targetPlayer.roleId,
    });

    await resoveAction(roomId, io, socket, updated);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.abuJanzeerAction = async (
  io,
  socket,
  { roomId, targetId, playerId },
) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Validate target is alive and in the room
    const targetPlayer = room.players.find(
      (p) => pidOf(p) === targetId,
    );
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push target
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: { abuJanzeerTargets: { player: playerId, target: targetId } },
      },
      { new: true },
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket, updated);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.ballahAction = async (io, socket, { roomId, targetId, playerId }) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Ballah can only kill once per game
    if (room.ballahAttackUsedBy.includes(playerId)) {
      socket.emit("actionError", { message: "لقد استخدمت السيف بالفعل" });
      return;
    }

    // Validate target is alive and in the room
    const targetPlayer = room.players.find(
      (p) => pidOf(p) === targetId,
    );
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push targets
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: {
          ballahTargets: { player: playerId, target: targetId },
          ballahAttackUsedBy: playerId,
        },
      },
      { new: true },
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket, updated);
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
      { new: true },
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket, updated);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.ba3atiKabeerAction = async (
  io,
  socket,
  { roomId, targetId, playerId },
) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Validate target is alive and in the room
    const targetPlayer = room.players.find(
      (p) => pidOf(p) === targetId,
    );
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push target (kill mode)
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: { ba3atiKabeerTargets: { player: playerId, target: targetId } },
      },
      { new: true },
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket, updated);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.ba3atiKabeerConvert = async (
  io,
  socket,
  { roomId, targetId, playerId },
) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Ba3ati Kabeer can only convert once per game
    if (room.ba3atiKabeerConvertUsedBy.includes(playerId)) {
      socket.emit("actionError", { message: "لقد استخدمت التحويل بالفعل" });
      return;
    }

    // Validate target is alive and in the room
    const targetPlayer = room.players.find(
      (p) => pidOf(p) === targetId,
    );
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Convert can only target non-ba3ati roles
    if (targetPlayer.roleId === "1" || targetPlayer.roleId === "7") {
      socket.emit("actionError", {
        message: "لا يمكن تحويل لاعب من فريق البعاتي",
      });
      return;
    }

    // Atomically update player status and push convert target
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: {
          ba3atiKabeerConvertTargets: { player: playerId, target: targetId },
          ba3atiKabeerConvertUsedBy: playerId,
        },
      },
      { new: true },
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket, updated);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};

exports.jenabuAction = async (
  io,
  socket,
  { roomId, target1Id, target2Id, playerId },
) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Validate both targets are alive and different
    if (target1Id === target2Id) return;
    const target1Player = room.players.find(
      (p) => pidOf(p) === target1Id,
    );
    const target2Player = room.players.find(
      (p) => pidOf(p) === target2Id,
    );
    if (!target1Player || target1Player.status !== "alive") return;
    if (!target2Player || target2Player.status !== "alive") return;

    // Determine team for each target based on their current roleId
    const getTeam = (roleId) => {
      if (roleId === "1" || roleId === "7") return "ba3ati";
      if (roleId === "5") return "abuJanzeer";
      return "villagers";
    };
    const sameTeam =
      getTeam(target1Player.roleId) === getTeam(target2Player.roleId);

    // Atomically update player status and push targets
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done" },
        $push: {
          jenabuTargets: {
            player: playerId,
            target1: target1Id,
            target2: target2Id,
          },
        },
      },
      { new: true },
    );
    if (!updated) return;

    // Privately reveal the result, only once the action was accepted
    socket.emit("jenabuReveal", {
      target1Id,
      target1Name: target1Player.player.name,
      target2Id,
      target2Name: target2Player.player.name,
      sameTeam,
    });

    await resoveAction(roomId, io, socket, updated);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};
exports.wadAlzalatAction = async (
  io,
  socket,
  { roomId, targetId, playerId },
) => {
  try {
    const room = await Room.findOne({ roomId }).populate(PLAYER_POPULATE);
    if (!room) return;

    // Wad Alzalat can only use water once per match
    if (room.wadAlzalatUsedBy.includes(playerId)) {
      socket.emit("actionError", {
        message: "لقد استخدمت جردل الماء بالفعل",
      });
      return;
    }

    // Validate target is alive and in the room
    const targetPlayer = room.players.find(
      (p) => pidOf(p) === targetId,
    );
    if (!targetPlayer || targetPlayer.status !== "alive") return;

    // Atomically update player status and push targets
    const updated = await Room.findOneAndUpdate(
      playerElemMatch(roomId, playerId),
      {
        $set: { "players.$.playStatus": "done", "players.$.target": targetId },
        $push: {
          wadAlzalatTargets: { player: playerId, target: targetId },
          wadAlzalatUsedBy: playerId,
        },
      },
      { new: true },
    );
    if (!updated) return;

    await resoveAction(roomId, io, socket, updated);
    return;
  } catch (error) {
    console.log(error);
    return;
  }
};

// Every handler mutates the room, so each runs under the room lock.
const locked = (fn) => (io, socket, arg) => {
  const roomId = arg && arg.roomId;
  if (!roomId) return;
  return withRoomLock(roomId, () => fn(io, socket, arg));
};
for (const name of Object.keys(exports)) {
  exports[name] = locked(exports[name]);
}
