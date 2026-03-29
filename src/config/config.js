const dotenv = require("dotenv");

dotenv.config();

const parseGoogleClientIds = () => {
  const clientIds = [];

  if (process.env.GOOGLE_CLIENT_IDS) {
    clientIds.push(
      ...process.env.GOOGLE_CLIENT_IDS.split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    );
  }

  if (process.env.GOOGLE_CLIENT_ID) {
    clientIds.push(process.env.GOOGLE_CLIENT_ID.trim());
  }

  return [...new Set(clientIds)];
};

module.exports = {
  env: process.env.NODE_ENV,
  port: process.env.PORT || 3000,
  mongo: {
    uri: process.env.MONGO_URI,
    options: {
      maxPoolSize: 25,
      minPoolSize: 10,
    },
  },
  jwtSecret: process.env.JWT_SECRET,
  livekitApiKey: process.env.LIVEKIT_API_KEY,
  livekitApiSecret: process.env.LIVEKIT_API_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientIds: parseGoogleClientIds(),
};
