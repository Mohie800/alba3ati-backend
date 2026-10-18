// Shared helpers for Room player entries.

// Private / heavy User fields never sent to other players in room payloads.
// Exclusion (not inclusion) so new cosmetic fields still reach clients.
const PLAYER_POPULATE = {
  path: "players.player",
  select:
    "-email -googleId -deviceId -expoPushToken -coins -ownedFrames -ownedNameColors -ownedProfilePictures -ownedRoles -notificationPreferences -friendCount",
};

// Player id as a string, whether `player` is populated, a raw ObjectId, or
// null (populate yields null when the User was deleted).
const pidOf = (entry) => {
  const p = entry && entry.player;
  if (!p) return null;
  if (p._id) return p._id.toString();
  return p.toString();
};

const findPlayer = (room, playerId) =>
  room.players.find((p) => pidOf(p) === String(playerId));

const hasPlayer = (room, playerId) => !!findPlayer(room, playerId);

module.exports = { PLAYER_POPULATE, pidOf, findPlayer, hasPlayer };
