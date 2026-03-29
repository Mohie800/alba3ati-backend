const { OAuth2Client } = require("google-auth-library");
const config = require("../config/config");

const client = new OAuth2Client(config.googleClientId);

const verifyGoogleToken = async (idToken) => {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: config.googleClientId,
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
