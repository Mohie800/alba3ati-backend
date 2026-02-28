const express = require("express");
const { AccessToken } = require("livekit-server-sdk");
const config = require("../../config/config");

const router = express.Router();

router.get("/token", async (req, res) => {
  const { roomId, userId, userName } = req.query;

  if (!roomId || !userId || !userName) {
    return res
      .status(400)
      .json({ error: "roomId, userId, and userName are required" });
  }

  if (!config.livekitApiKey || !config.livekitApiSecret) {
    return res.status(500).json({ error: "LiveKit is not configured" });
  }

  const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: userId,
    name: userName,
  });

  at.addGrant({
    roomJoin: true,
    room: `alba3ati-${roomId}`,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  res.json({ token });
});

module.exports = router;
