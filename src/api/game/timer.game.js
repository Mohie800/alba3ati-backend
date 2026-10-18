const Room = require("../models/room.model");
const { withRoomLock, runDetached } = require("./roomLock");
const { LEGACY_TICKS } = require("../../utils/constants");

// Deadline-based phase timers. The deadline lives on the room
// (`phaseEndsAt`, saved together with `gamePhase`), so a restart can re-arm
// it. One timeout per room fires the phase's handler; clients get the
// deadline once via "phaseTimer" and count down locally.
//
// Handlers are required lazily: they import this module themselves.
const PHASES = {
  night: {
    tickEvent: "tick",
    endEvent: "timerEnd",
    run: (io, roomId) => require("./calculate.game").claculateResult(io, roomId),
  },
  nightResults: {
    run: (io, roomId) => require("./results.game").nightResults(io, roomId, false),
  },
  discussion: {
    tickEvent: "tick",
    endEvent: "timerEnds",
    run: (io, roomId) => require("./results.game").startVotingPhase(io, roomId),
  },
  voting: {
    tickEvent: "tick",
    endEvent: "votingTimeUp",
    run: (io, roomId) =>
      require("./claculateVoteResult.game").claculateVoteResult(io, roomId),
  },
  voteResults: {
    run: (io, roomId) => require("./results.game").nightResults(io, roomId, true),
  },
  rematch: {
    tickEvent: "rematchTick",
    run: (io, roomId) => require("./rematch.game").rematchTimeout(io, roomId),
  },
};

// roomId -> { phase, endsAt, timeoutId, tickId }
const activeTimers = new Map();

const isTimedPhase = (phase) => Object.prototype.hasOwnProperty.call(PHASES, phase);

const secondsLeft = (endsAt) => Math.max(0, Math.round((endsAt - Date.now()) / 1000));

// Sets the phase and its deadline on the doc; the caller saves, then calls
// startPhaseTimer. An invalid duration on a timed phase ends it immediately
// rather than hanging the game.
exports.setPhase = (room, phase, durationSec) => {
  room.gamePhase = phase;
  if (!isTimedPhase(phase)) {
    room.phaseEndsAt = null;
    return;
  }
  const ms = durationSec > 0 ? durationSec * 1000 : 0;
  room.phaseEndsAt = new Date(Date.now() + ms);
};

// Arms the timer for the room's saved phase + deadline (no-op for untimed
// phases). Replaces any previous timer for the room.
exports.startPhaseTimer = (io, room) => {
  const roomId = room.roomId;
  exports.cancelTimer(roomId);

  const cfg = PHASES[room.gamePhase];
  if (!cfg || !room.phaseEndsAt) return;

  const phase = room.gamePhase;
  const endsAt = new Date(room.phaseEndsAt).getTime();
  const timer = { phase, endsAt, timeoutId: null, tickId: null };

  timer.timeoutId = runDetached(() =>
    setTimeout(() => fire(io, roomId, timer), Math.max(0, endsAt - Date.now())),
  );
  if (LEGACY_TICKS && cfg.tickEvent) {
    timer.tickId = runDetached(() =>
      setInterval(() => {
        if (activeTimers.get(roomId) !== timer) {
          clearInterval(timer.tickId);
          return;
        }
        const left = secondsLeft(endsAt);
        if (left > 0) io.to(roomId).emit(cfg.tickEvent, left);
      }, 1000),
    );
  }
  activeTimers.set(roomId, timer);

  io.to(roomId).emit("phaseTimer", {
    roomId,
    phase,
    endsAt,
    serverNow: Date.now(),
  });
  if (LEGACY_TICKS && cfg.tickEvent) io.to(roomId).emit(cfg.tickEvent, secondsLeft(endsAt));
};

const fire = (io, roomId, timer) => {
  if (activeTimers.get(roomId) !== timer) return;
  clearInterval(timer.tickId);
  activeTimers.delete(roomId);

  const cfg = PHASES[timer.phase];
  if (LEGACY_TICKS && cfg.tickEvent) io.to(roomId).emit(cfg.tickEvent, 0);
  if (cfg.endEvent) io.to(roomId).emit(cfg.endEvent);

  withRoomLock(roomId, async () => {
    // Only act if the room is still in the phase/deadline this timer was for.
    const room = await Room.findOne({ roomId }, "status gamePhase phaseEndsAt");
    if (!room || room.status !== "playing" || room.gamePhase !== timer.phase) return;
    if (!room.phaseEndsAt || room.phaseEndsAt.getTime() !== timer.endsAt) return;
    await cfg.run(io, roomId);
  }).catch((err) =>
    console.error(`[Timer] ${timer.phase} handler failed for ${roomId}:`, err),
  );
};

exports.cancelTimer = (roomId) => {
  const timer = activeTimers.get(roomId);
  if (timer) {
    clearTimeout(timer.timeoutId);
    clearInterval(timer.tickId);
    activeTimers.delete(roomId);
  }
};

// Seconds left in the room's running phase (0 if none).
exports.getRemainingTime = (roomId) => {
  const timer = activeTimers.get(roomId);
  return timer ? secondsLeft(timer.endsAt) : 0;
};

exports.getTimerPhase = (roomId) => activeTimers.get(roomId)?.phase || null;

// Deadline fields for reconnect/spectate payloads.
exports.timerPayload = (room) => ({
  phaseEndsAt: room.phaseEndsAt ? new Date(room.phaseEndsAt).getTime() : null,
  serverNow: Date.now(),
});

exports.isTimedPhase = isTimedPhase;
