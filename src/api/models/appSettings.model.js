const mongoose = require("mongoose");

const appSettingsSchema = new mongoose.Schema(
  {
    forceUpdate: { type: Boolean, default: false },
    minVersion: { type: String, default: "1.0.0" },
    updateMessage: { type: String, default: "يرجى تحديث التطبيق للاستمرار" },
    playStoreUrl: { type: String, default: "" },
    appStoreUrl: { type: String, default: "" },
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: {
      type: String,
      default: "اللعبة تحت الصيانة حالياً، يرجى المحاولة لاحقاً",
    },
    coinRewards: {
      gameComplete: { type: Number, default: 10 },
      gameWin: { type: Number, default: 20 },
      adReward: { type: Number, default: 15 },
      maxAdsPerDay: { type: Number, default: 5 },
    },
    communityLinks: {
      enabled: { type: Boolean, default: false },
      whatsapp: {
        url: { type: String, default: "" },
        enabled: { type: Boolean, default: false },
      },
      telegram: {
        url: { type: String, default: "" },
        enabled: { type: Boolean, default: false },
      },
      discord: {
        url: { type: String, default: "" },
        enabled: { type: Boolean, default: false },
      },
    },
  },
  { timestamps: true }
);

// In-memory cache for settings (avoids DB hit on every socket event)
let cachedSettings = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds

// Singleton: only one settings document exists
appSettingsSchema.statics.getSettings = async function () {
  if (cachedSettings && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedSettings;
  }
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  cachedSettings = settings;
  cacheTimestamp = Date.now();
  return settings;
};

// Clear cache when settings are updated (call from admin routes)
appSettingsSchema.statics.clearCache = function () {
  cachedSettings = null;
  cacheTimestamp = 0;
};

module.exports = mongoose.model("AppSettings", appSettingsSchema);
