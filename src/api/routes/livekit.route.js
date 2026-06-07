const express = require("express");
const { AccessToken } = require("livekit-server-sdk");
const config = require("../../config/config");
const Room = require("../models/room.model");

const router = express.Router();

router.get("/token", async (req, res) => {
  const { roomId, userId, userName, mode } = req.query;

  if (!roomId || !userId || !userName) {
    return res
      .status(400)
      .json({ error: "roomId, userId, and userName are required" });
  }

  if (!config.livekitApiKey || !config.livekitApiSecret) {
    return res.status(500).json({ error: "LiveKit is not configured" });
  }

  // Authorisation: only people who actually belong to the room may get a token.
  // Without this, anyone could mint a listen-only token for any room and
  // eavesdrop on its voice chat. Moderators use the admin-authenticated
  // /api/admin/voice/token route instead.
  const room = await Room.findOne({ roomId })
    .select("host players spectators")
    .lean();

  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  const isMember =
    room.host === userId ||
    (room.players || []).some(
      (p) => p.player && p.player.toString() === userId,
    ) ||
    (room.spectators || []).some(
      (s) => s.user && s.user.toString() === userId,
    );

  if (!isMember) {
    return res.status(403).json({ error: "Not a member of this room" });
  }

  const isSpectator = mode === "spectator";

  const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: userId,
    name: userName,
  });

  at.addGrant({
    roomJoin: true,
    room: `alba3ati-${roomId}`,
    canPublish: !isSpectator,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  res.json({ token });
});

module.exports = router;
