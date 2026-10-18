const Room = require("../models/room.model");
const presence = require("../services/presence.service");
const { withRoomLock } = require("./roomLock");
const { pidOf } = require("./roomUtils");
const { startPhaseTimer, isTimedPhase } = require("./timer.game");
const {
  startGracePeriod,
  startWaitingGracePeriod,
} = require("./disconnect.game");
const { restoreActiveQuickPlayRoom } = require("./quickPlay.game");
const {
  RESTART_GRACE_PERIOD,
  RESTART_MIN_PHASE_MS,
  RESTART_ABANDONED_MS,
  RESTART_MAX_AGE_MS,
} = require("../../utils/constants");

// Resumes every active room after a restart. All game state is on the room
// doc; what was in memory is rebuilt here: phase timers from `phaseEndsAt`,
// and a reconnect grace period for every seated player (nobody is connected
// yet, so it is a mass disconnect).
const recoverActiveRooms = async (io) => {
  // activePlayers is the connected-player count as of the last write before
  // the stop, so a room still being played isn't ended for a long phase.
  const now = Date.now();
  const abandoned = await Room.updateMany(
    {
      status: { $in: ["waiting", "playing"] },
      $or: [
        { activePlayers: 0, updatedAt: { $lt: new Date(now - RESTART_ABANDONED_MS) } },
        { updatedAt: { $lt: new Date(now - RESTART_MAX_AGE_MS) } },
      ],
    },
    { $set: { status: "ended", activePlayers: 0 } },
  );

  const rooms = await Room.find({ status: { $in: ["waiting", "playing"] } });
  let resumed = 0;
  for (const doc of rooms) {
    try {
      await withRoomLock(doc.roomId, () => recoverRoom(io, doc.roomId));
      resumed++;
    } catch (err) {
      console.error(`[Recovery] failed for room ${doc.roomId}:`, err);
    }
  }
  await restoreActiveQuickPlayRoom();

  console.log(
    `[Recovery] resumed ${resumed} room(s), ended ${abandoned.modifiedCount} abandoned`,
  );
};

const recoverRoom = async (io, roomId) => {
  const room = await Room.findOne({ roomId });
  if (!room || (room.status !== "waiting" && room.status !== "playing")) return;

  room.activePlayers = 0;
  const timed = room.status === "playing" && isTimedPhase(room.gamePhase);
  if (timed) {
    // Give players time to reconnect before the phase can end.
    const minEnd = Date.now() + RESTART_MIN_PHASE_MS;
    if (!room.phaseEndsAt || room.phaseEndsAt.getTime() < minEnd) {
      room.phaseEndsAt = new Date(minEnd);
    }
  }
  await room.save();

  presence.setRoomStatus(roomId, room.status);
  if (timed) startPhaseTimer(io, room);

  for (const p of room.players) {
    const playerId = pidOf(p);
    if (!playerId) continue;
    if (room.status === "waiting") {
      startWaitingGracePeriod(io, roomId, playerId, RESTART_GRACE_PERIOD);
    } else if (p.status === "alive") {
      startGracePeriod(io, roomId, playerId, RESTART_GRACE_PERIOD);
    }
  }
};

module.exports = { recoverActiveRooms };
