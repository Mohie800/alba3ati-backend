const User = require("../models/user.model");
const DeviceSeen = require("../models/deviceSeen.model");
const CoinTransaction = require("../models/coinTransaction.model");
const AppSettings = require("../models/appSettings.model");
const { sendPushNotification } = require("./pushNotification.service");

// No 0/O/1/I so codes survive being read aloud or typed from a screenshot
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
// The Google flow enters the code after account creation; past this it's too late
const APPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

const normalizeCode = (code) =>
  typeof code === "string" ? code.trim().toUpperCase() : "";

function randomCode() {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

async function ensureReferralCode(user) {
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const updated = await User.findOneAndUpdate(
      { _id: user._id, referralCode: { $exists: false } },
      { $set: { referralCode: code } },
      { new: true },
    ).catch((err) => {
      if (err.code === 11000) return null; // collision with another user's code
      throw err;
    });
    if (updated) return updated.referralCode;
    const fresh = await User.findById(user._id).select("referralCode");
    if (fresh?.referralCode) return fresh.referralCode;
  }
  throw new Error("Could not allocate a referral code");
}

// Guest accounts stored the raw id (iOS IDFV is uppercase), so match both cases
async function isDeviceNew(normalizedDeviceId, excludeUserId = null) {
  if (!normalizedDeviceId) return false;
  if (await DeviceSeen.exists({ deviceId: normalizedDeviceId })) return false;
  const query = {
    deviceId: { $in: [normalizedDeviceId, normalizedDeviceId.toUpperCase()] },
  };
  if (excludeUserId) query._id = { $ne: excludeUserId };
  return !(await User.exists(query));
}

function markDeviceSeen(normalizedDeviceId) {
  if (!normalizedDeviceId) return Promise.resolve();
  return DeviceSeen.updateOne(
    { deviceId: normalizedDeviceId },
    { $setOnInsert: { deviceId: normalizedDeviceId } },
    { upsert: true },
  ).catch((err) => {
    if (err.code !== 11000) console.error("markDeviceSeen error:", err);
  });
}

// Links a fresh account to a referrer. Returns { ok, reason } — reasons map to app copy.
async function linkReferral(user, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "EMPTY" };

  const settings = await AppSettings.getSettings();
  const cfg = settings.referral || {};
  if (cfg.enabled === false) return { ok: false, reason: "DISABLED" };

  if (user.referredBy || user.referralStatus) {
    return { ok: false, reason: "ALREADY_REFERRED" };
  }
  if (!user.referralEligible) return { ok: false, reason: "DEVICE_NOT_NEW" };
  if ((user.stats?.gamesPlayed || 0) > 0) {
    return { ok: false, reason: "TOO_LATE" };
  }
  if (Date.now() - new Date(user.createdAt).getTime() > APPLY_WINDOW_MS) {
    return { ok: false, reason: "TOO_LATE" };
  }

  const referrer = await User.findOne({ referralCode: code }).select(
    "_id deviceId",
  );
  if (!referrer) return { ok: false, reason: "INVALID_CODE" };
  if (String(referrer._id) === String(user._id)) {
    return { ok: false, reason: "SELF" };
  }

  const max = cfg.maxPerReferrer || 0;
  if (max > 0) {
    const used = await User.countDocuments({ referredBy: referrer._id });
    if (used >= max) return { ok: false, reason: "REFERRER_LIMIT" };
  }

  const updated = await User.findOneAndUpdate(
    { _id: user._id, referredBy: null, referralStatus: null },
    { $set: { referredBy: referrer._id, referralStatus: "pending" } },
    { new: true },
  );
  if (!updated) return { ok: false, reason: "ALREADY_REFERRED" };
  return { ok: true };
}

// Called after a game ends with the ids of players who finished it (didn't leave)
async function payDueReferrals(finishedPlayerIds) {
  if (!finishedPlayerIds.length) return;
  const pending = await User.find({
    _id: { $in: finishedPlayerIds },
    referralStatus: "pending",
  }).select("_id name referredBy");
  if (!pending.length) return;

  const settings = await AppSettings.getSettings();
  const cfg = settings.referral || {};
  const referrerReward = cfg.referrerReward ?? 100;
  const refereeReward = cfg.refereeReward ?? 100;

  for (const referee of pending) {
    try {
      // Status flip is the idempotency guard: only one game end can pay
      const claimed = await User.findOneAndUpdate(
        { _id: referee._id, referralStatus: "pending" },
        {
          $set: { referralStatus: "rewarded", referralRewardedAt: new Date() },
          $inc: { coins: refereeReward },
        },
        { new: true },
      );
      if (!claimed) continue;

      const referrer = await User.findByIdAndUpdate(
        referee.referredBy,
        { $inc: { coins: referrerReward } },
        { new: true },
      );

      const txs = [
        {
          user: claimed._id,
          amount: refereeReward,
          balance: claimed.coins,
          type: "referral_bonus",
          meta: { role: "referee", referrer: referee.referredBy },
        },
      ];
      if (referrer) {
        txs.push({
          user: referrer._id,
          amount: referrerReward,
          balance: referrer.coins,
          type: "referral_bonus",
          meta: { role: "referrer", referee: claimed._id },
        });
      }
      await CoinTransaction.insertMany(txs);

      sendPushNotification({
        title: "مكافأة الدعوة 🎁",
        body: `حصلت على ${refereeReward} عملة لإكمالك أول لعبة!`,
        data: { type: "referral_reward" },
        userIds: [claimed._id],
        type: "targeted",
      }).catch(() => {});
      if (referrer) {
        sendPushNotification({
          title: "مكافأة الدعوة 🎁",
          body: `${claimed.name} أكمل أول لعبة له، حصلت على ${referrerReward} عملة!`,
          data: { type: "referral_reward" },
          userIds: [referrer._id],
          type: "targeted",
        }).catch(() => {});
      }
    } catch (err) {
      console.error("payDueReferrals error:", err);
    }
  }
}

module.exports = {
  normalizeCode,
  ensureReferralCode,
  isDeviceNew,
  markDeviceSeen,
  linkReferral,
  payDueReferrals,
  APPLY_WINDOW_MS,
};
