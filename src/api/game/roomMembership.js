const Room = require("../models/room.model");
const presence = require("../services/presence.service");

const socketsIn = (io, roomId) => {
  const ids = io.sockets.adapter.rooms.get(roomId);
  if (!ids) return [];
  const result = [];
  for (const sid of ids) {
    const s = io.sockets.sockets.get(sid);
    if (s) result.push(s);
  }
  return result;
};

// Counts only non-spectator sockets so spectator joins/leaves never affect
// activePlayers, grace-period logic, or "room is empty" cleanup.
const getPlayerSocketCount = (io, roomId) =>
  socketsIn(io, roomId).filter((s) => !s.isSpectator).length;

// Live player (non-spectator) sockets of one user seated in a room.
const getPlayerSockets = (io, roomId, playerId) =>
  socketsIn(io, roomId).filter(
    (s) => !s.isSpectator && s.playerId === String(playerId),
  );

// The only place a socket gets attached to a game room.
const seatSocket = async (io, socket, roomId, playerId, { spectator = false } = {}) => {
  socket.join(roomId);
  socket.gameRoomId = roomId;
  socket.playerId = String(playerId);
  socket.isSpectator = spectator;
  presence.attachSocket(socket, playerId);
  if (!spectator) {
    await Room.updateOne(
      { roomId },
      { $set: { activePlayers: getPlayerSocketCount(io, roomId) } },
    );
  }
};

// Detach a socket from its room without running any leave logic (used when a
// newer socket of the same player takes over the seat).
const unseatSocket = (socket) => {
  if (socket.gameRoomId) socket.leave(socket.gameRoomId);
  socket.gameRoomId = null;
  socket.isSpectator = false;
  presence.refreshSocket(socket);
};

// A player's seat belongs to their newest socket. A stale socket (old
// connection not yet timed out after a network switch) is unseated so the
// rejoin succeeds and its later disconnect doesn't start a grace period.
const takeOverSeat = (io, socket, roomId, playerId) => {
  for (const other of getPlayerSockets(io, roomId, playerId)) {
    if (other.id !== socket.id) unseatSocket(other);
  }
};

module.exports = {
  getPlayerSocketCount,
  getPlayerSockets,
  seatSocket,
  unseatSocket,
  takeOverSeat,
};
