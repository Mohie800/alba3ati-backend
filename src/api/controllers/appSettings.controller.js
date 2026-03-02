const AppSettings = require("../models/appSettings.model");

// Public: called by the mobile app on startup
exports.checkUpdate = async (req, res) => {
  try {
    const { version } = req.query;
    const settings = await AppSettings.getSettings();

    const response = {
      forceUpdate: false,
      maintenanceMode: settings.maintenanceMode,
      maintenanceMessage: settings.maintenanceMessage,
    };

    if (!settings.forceUpdate || !version) {
      return res.json(response);
    }

    const needsUpdate = compareVersions(version, settings.minVersion) < 0;

    return res.json({
      ...response,
      forceUpdate: needsUpdate,
      minVersion: settings.minVersion,
      updateMessage: settings.updateMessage,
      playStoreUrl: settings.playStoreUrl,
      appStoreUrl: settings.appStoreUrl,
    });
  } catch (error) {
    console.error("checkUpdate error:", error);
    // Don't block the app if this fails
    return res.json({ forceUpdate: false });
  }
};

// Admin: get current settings
exports.getSettings = async (req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    return res.json({ data: settings });
  } catch (error) {
    console.error("getSettings error:", error);
    return res.status(500).json({ error: "Failed to fetch settings" });
  }
};

// Admin: update settings
exports.updateSettings = async (req, res) => {
  try {
    const { forceUpdate, minVersion, updateMessage, playStoreUrl, appStoreUrl, maintenanceMode, maintenanceMessage } = req.body;
    const settings = await AppSettings.getSettings();

    if (typeof forceUpdate === "boolean") settings.forceUpdate = forceUpdate;
    if (minVersion) settings.minVersion = minVersion;
    if (typeof updateMessage === "string") settings.updateMessage = updateMessage;
    if (typeof playStoreUrl === "string") settings.playStoreUrl = playStoreUrl;
    if (typeof appStoreUrl === "string") settings.appStoreUrl = appStoreUrl;
    if (typeof maintenanceMode === "boolean") settings.maintenanceMode = maintenanceMode;
    if (typeof maintenanceMessage === "string") settings.maintenanceMessage = maintenanceMessage;

    await settings.save();
    return res.json({ data: settings });
  } catch (error) {
    console.error("updateSettings error:", error);
    return res.status(500).json({ error: "Failed to update settings" });
  }
};

// Compare semver strings: returns -1, 0, or 1
function compareVersions(current, minimum) {
  const cur = current.split(".").map(Number);
  const min = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const a = cur[i] || 0;
    const b = min[i] || 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}
