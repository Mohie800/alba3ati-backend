exports.ROLES = [
  { id: "1", name: "البعاتي", color: "#4A90E2" },
  { id: "2", name: "العمدة", color: "#50E3C2" },
  { id: "3", name: "شيخ الدمازين", color: "#E94F37" },
  { id: "4", name: "الكاشف", color: "#8E44AD" },
  { id: "5", name: "ابو جنزير", color: "#F1C40F" },
  { id: "6", name: "بله اب سيف", color: "#D35400" },
  { id: "7", name: "بعاتي كبير", color: "#1A5276" },
  { id: "8", name: "جنابو", color: "#2E86C1" },
  { id: "9", name: "وَد الزلط", color: "#90EE90" },
];

// Core roles that every game requires — these can never be locked/sold.
exports.MANDATORY_ROLE_IDS = ["1", "2"];

exports.ROUND_TIME = 70;
exports.DIS_DUE = 10;
exports.VOTE_TIME = 30;
exports.GRACE_PERIOD = 60;
exports.NIGHT_RESULTS_TIME = 8; // night results screen before discussion
exports.VOTE_RESULTS_TIME = 5; // vote results screen before the next night
exports.REMATCH_TIME = 30;

// Per-second "tick"/"rematchTick" events for app builds that don't read
// phaseEndsAt yet. Turn off once those builds are gone.
exports.LEGACY_TICKS = false;

// After a server restart: reconnect window for every seated player, and the
// minimum time left in a running phase so players can reconnect first.
exports.RESTART_GRACE_PERIOD = 60;
exports.RESTART_MIN_PHASE_MS = 20000;
// Not resumed after a restart: rooms with no connected players for this long
// (what the stale-room sweep would have ended), or untouched for the cap.
exports.RESTART_ABANDONED_MS = 5 * 60 * 1000;
exports.RESTART_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Hard cap on players in any room (custom, quick play, rematch joins).
exports.MAX_ROOM_PLAYERS = 20;

// Quick Play
exports.QUICK_PLAY_MIN_PLAYERS = 8;
exports.QUICK_PLAY_MAX_PLAYERS = 20;
exports.QUICK_PLAY_COUNTDOWN = 10; // seconds
exports.QUICK_PLAY_GRACE_PERIOD = 15; // seconds (vs 60 for normal)
exports.QUICK_PLAY_DISCUSSION_TIME = 180; // 3 minutes in seconds

// Spectators
exports.MAX_SPECTATORS = 20;

// Player IDs allowed to bypass maintenance mode (admin/dev accounts).
exports.MAINTENANCE_BYPASS_USER_IDS = new Set([
  "69c9ab1a6631e3885a13ed49",
]);
