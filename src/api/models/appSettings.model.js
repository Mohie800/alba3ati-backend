const mongoose = require("mongoose");

const appSettingsSchema = new mongoose.Schema(
  {
    forceUpdate: { type: Boolean, default: false },
    minVersion: { type: String, default: "1.0.0" },
    updateMessage: { type: String, default: "يرجى تحديث التطبيق للاستمرار" },
    playStoreUrl: { type: String, default: "" },
    appStoreUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

// Singleton: only one settings document exists
appSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model("AppSettings", appSettingsSchema);
