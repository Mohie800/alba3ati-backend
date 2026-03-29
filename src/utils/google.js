const { OAuth2Client } = require("google-auth-library");
const config = require("../config/config");

const client = new OAuth2Client();

const verifyGoogleToken = async (idToken) => {
  const audiences =
    config.googleClientIds && config.googleClientIds.length
      ? config.googleClientIds
      : config.googleClientId
        ? [config.googleClientId]
        : [];

  if (!audiences.length) {
    throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_IDS is not configured");
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience: audiences,
  });

  const payload = ticket.getPayload();
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    emailVerified: payload.email_verified,
  };
};

module.exports = { verifyGoogleToken };
