const { AsyncLocalStorage } = require("async_hooks");

// Per-room mutex. Every Room read-modify-write runs serially per roomId, which
// removes the VersionError / double-resolution races. Valid because the game
// server is a single process (timers and grace periods are in-memory too).

const tails = new Map(); // key -> promise that settles when the last holder releases
const heldStore = new AsyncLocalStorage(); // Map<key, holderToken> for re-entrancy
const LOCK_WATCHDOG_MS = 15000;

function withRoomLock(roomId, fn) {
  const key = String(roomId);

  // Re-entrant: a holder calling another locked function for the same room
  // runs inline instead of deadlocking on itself.
  const held = heldStore.getStore();
  const token = held && held.get(key);
  if (token && token.active) return Promise.resolve().then(fn);

  const prev = tails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const tail = prev.then(() => gate);
  tails.set(key, tail);

  return prev.then(() => {
    const myToken = { active: true };
    const nextHeld = new Map(held || []);
    nextHeld.set(key, myToken);

    const watchdog = setTimeout(() => {
      console.error(`[RoomLock] ${key} held for >${LOCK_WATCHDOG_MS}ms, releasing`);
      myToken.active = false;
      release();
    }, LOCK_WATCHDOG_MS);

    const done = () => {
      clearTimeout(watchdog);
      myToken.active = false;
      release();
      if (tails.get(key) === tail) tails.delete(key);
    };

    return heldStore.run(nextHeld, async () => {
      try {
        return await fn();
      } finally {
        done();
      }
    });
  });
}

// Timers created inside a locked section must not inherit the lock context,
// otherwise their callbacks would look re-entrant and skip the queue.
function runDetached(fn) {
  return heldStore.exit(fn);
}

// Run `fn` under the room lock after `ms`. Returns the timeout handle.
function scheduleRoomTask(roomId, ms, fn, label = "task") {
  return runDetached(() =>
    setTimeout(() => {
      withRoomLock(roomId, fn).catch((err) =>
        console.error(`[RoomLock] ${label} failed for ${roomId}:`, err),
      );
    }, ms),
  );
}

// Resolves once no room work is queued or running (or after timeoutMs).
async function waitForIdle(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (tails.size > 0 && Date.now() < deadline) {
    await Promise.race([
      Promise.all([...tails.values()]),
      new Promise((resolve) => setTimeout(resolve, 50)),
    ]);
  }
  return tails.size === 0;
}

module.exports = { withRoomLock, runDetached, scheduleRoomTask, waitForIdle };
