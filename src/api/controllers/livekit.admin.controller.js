const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");
const config = require("../../config/config");
const Room = require("../models/room.model");

// LiveKit room names are namespaced as `alba3ati-<roomId>` (see livekit.route.js
// and the mobile client). Strip/add this prefix to map between the two.
const ROOM_PREFIX = "alba3ati-";

// Identity prefix used for moderator listen-in sessions. These are hidden from
// players (see getVoiceToken) and filtered out of the participant lists so one
// moderator never sees another.
const MONITOR_PREFIX = "admin-monitor-";

// TrackSource enum from the LiveKit protocol: MICROPHONE = 2.
const TRACK_SOURCE_MICROPHONE = 2;

function svcClient() {
  return new RoomServiceClient(
    config.livekitUrl,
    config.livekitApiKey,
    config.livekitApiSecret,
  );
}

// protobuf timestamps come back as seconds (number | bigint). Normalise to ms.
function toMillis(seconds) {
  if (!seconds) return null;
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

// GET /api/admin/voice/rooms
// Lists every live LiveKit room (game voice channels), enriched with the
// game-room state from Mongo (host, status, phase). Participant mic state is
// derived from published audio tracks — note this reflects "mic on / muted",
// not real-time speaking, which the listener page tracks live over the socket.
exports.getActiveRooms = async (req, res) => {
  if (!config.livekitApiKey || !config.livekitApiSecret) {
    return res
      .status(500)
      .json({ success: false, message: "LiveKit is not configured" });
  }

  try {
    const svc = svcClient();
    const lkRooms = (await svc.listRooms()).filter((r) =>
      r.name.startsWith(ROOM_PREFIX),
    );

    const withParticipants = await Promise.all(
      lkRooms.map(async (r) => {
        let participants = [];
        try {
          participants = await svc.listParticipants(r.name);
        } catch {
          participants = [];
        }
        return { room: r, participants };
      }),
    );

    // Join with game state in one query.
    const roomIds = lkRooms.map((r) => r.name.slice(ROOM_PREFIX.length));
    const gameRooms = await Room.find({ roomId: { $in: roomIds } })
      .select("roomId host status gamePhase players")
      .lean();
    const gameById = {};
    gameRooms.forEach((g) => {
      gameById[g.roomId] = g;
    });

    const rooms = withParticipants.map(({ room, participants }) => {
      const roomId = room.name.slice(ROOM_PREFIX.length);
      const game = gameById[roomId];

      const people = participants
        .filter((p) => !p.identity.startsWith(MONITOR_PREFIX))
        .map((p) => {
          const mic = (p.tracks || []).find(
            (t) => t.source === TRACK_SOURCE_MICROPHONE,
          );
          return {
            identity: p.identity,
            name: p.name || p.identity,
            joinedAt: toMillis(p.joinedAt),
            hasMic: !!mic,
            micOn: mic ? !mic.muted : false,
          };
        });

      return {
        roomId,
        livekitRoom: room.name,
        createdAt: toMillis(room.creationTime),
        numParticipants: people.length,
        status: game ? game.status : null,
        gamePhase: game ? game.gamePhase : null,
        host: game ? game.host : null,
        playerCount: game && game.players ? game.players.length : 0,
        participants: people,
      };
    });

    // Busiest rooms first.
    rooms.sort((a, b) => b.numParticipants - a.numParticipants);

    res.json({ success: true, data: { rooms, count: rooms.length } });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Failed to list voice rooms" });
  }
};

// GET /api/admin/voice/token?roomId=...
// Mints a listen-only, hidden moderator token for the given room. `hidden`
// keeps the moderator out of every participant's view so monitoring does not
// disrupt the game; `canPublish: false` makes it physically impossible to talk.
exports.getVoiceToken = async (req, res) => {
  const { roomId } = req.query;

  if (!roomId) {
    return res
      .status(400)
      .json({ success: false, message: "roomId is required" });
  }

  if (!config.livekitApiKey || !config.livekitApiSecret) {
    return res
      .status(500)
      .json({ success: false, message: "LiveKit is not configured" });
  }

  const adminId = (req.admin && req.admin.id) || "unknown";

  const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: `${MONITOR_PREFIX}${adminId}`,
    name: "Moderator",
  });

  at.addGrant({
    roomJoin: true,
    room: `${ROOM_PREFIX}${roomId}`,
    canPublish: false,
    canSubscribe: true,
    hidden: true,
  });

  const token = await at.toJwt();

  res.json({
    success: true,
    data: {
      token,
      // Clients connect over WebSocket; derive wss:// from the configured host.
      url: config.livekitUrl.replace(/^http/, "ws"),
      room: `${ROOM_PREFIX}${roomId}`,
    },
  });
};
