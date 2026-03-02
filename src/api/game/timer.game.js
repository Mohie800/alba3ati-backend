const roomModel = require("../models/room.model");

// Store active timers in a Map to manage multiple room timers
const activeTimers = new Map();

exports.startTimer = async (io, timeInSec, roomId, eventString, cb) => {
  // Clear existing timer for the room if any
  if (activeTimers.has(roomId)) {
    clearInterval(activeTimers.get(roomId).intervalId);
    activeTimers.delete(roomId);
  }
  const room = await roomModel.findOne({ roomId }).populate("players.player");

  // Handle immediate completion if time is <= 0
  if (timeInSec <= 0) {
    io.to(roomId).emit(eventString, room);
    return;
  }

  let remainingTime = timeInSec;

  // Create new timer
  const timer = {
    remainingTime,
    intervalId: setInterval(async () => {
      remainingTime--;
      timer.remainingTime = remainingTime;

      // Emit tick event to the room
      io.to(roomId).emit("tick", remainingTime);

      // Handle timer completion
      if (remainingTime <= 0) {
        clearInterval(timer.intervalId);
        activeTimers.delete(roomId);
        io.to(roomId).emit(eventString, room);
        if (cb) {
          console.log("cb");
          if (typeof cb === "function") {
            await cb(io, roomId);
            console.log("cbF");
          } else {
            console.log("cb error", cb);
          }
        }
      }
    }, 1000),
  };

  // Store timer reference
  activeTimers.set(roomId, timer);

  // Emit initial tick immediately if needed (optional)
  io.to(roomId).emit("tick", remainingTime);
};

exports.cancelTimer = (roomId) => {
  if (activeTimers.has(roomId)) {
    clearInterval(activeTimers.get(roomId).intervalId);
    activeTimers.delete(roomId);
  }
};

exports.getRemainingTime = (roomId) => {
  const timer = activeTimers.get(roomId);
  return timer ? timer.remainingTime : 0;
};
