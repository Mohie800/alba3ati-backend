const User = require("../models/user.model");
const CoinTransaction = require("../models/coinTransaction.model");
const AppSettings = require("../models/appSettings.model");
const AdRewardCounter = require("../models/adRewardCounter.model");

exports.getBalance = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("coins");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const settings = await AppSettings.getSettings();
    const maxAdsPerDay = settings.coinRewards?.maxAdsPerDay || 5;

    const today = new Date().toISOString().slice(0, 10);
    const counter = await AdRewardCounter.findOne({
      user: req.params.userId,
      date: today,
    });
    const adsWatchedToday = counter?.count || 0;

    res.json({
      success: true,
      data: { coins: user.coins, adsWatchedToday, maxAdsPerDay },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      CoinTransaction.find({ user: req.params.userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      CoinTransaction.countDocuments({ user: req.params.userId }),
    ]);

    res.json({
      success: true,
      data: {
        transactions,
        page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.claimAdReward = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId required" });
    }

    const settings = await AppSettings.getSettings();
    const adRewardAmount = settings.coinRewards?.adReward || 15;
    const maxAdsPerDay = settings.coinRewards?.maxAdsPerDay || 5;

    const today = new Date().toISOString().slice(0, 10);

    // Atomic: increment counter only if under daily limit.
    // findOneAndUpdate with $inc is a single atomic operation in MongoDB,
    // so concurrent requests cannot both read the same count.
    let counter;
    try {
      counter = await AdRewardCounter.findOneAndUpdate(
        { user: userId, date: today, count: { $lt: maxAdsPerDay } },
        { $inc: { count: 1 } },
        { upsert: true, new: true },
      );
    } catch (err) {
      // E11000 duplicate key: two concurrent requests raced to upsert the
      // first document for this user+date. Retry without upsert.
      if (err.code === 11000) {
        counter = await AdRewardCounter.findOneAndUpdate(
          { user: userId, date: today, count: { $lt: maxAdsPerDay } },
          { $inc: { count: 1 } },
          { new: true },
        );
        if (!counter) {
          return res.status(429).json({
            success: false,
            error: "daily_limit_reached",
            remaining: 0,
          });
        }
      } else {
        throw err;
      }
    }

    if (!counter) {
      return res.status(429).json({
        success: false,
        error: "daily_limit_reached",
        remaining: 0,
      });
    }

    const remaining = maxAdsPerDay - counter.count;

    const user = await User.findOneAndUpdate(
      { _id: userId },
      { $inc: { coins: adRewardAmount } },
      { new: true },
    );

    if (!user) {
      // Rollback the counter since the user doesn't exist
      await AdRewardCounter.findOneAndUpdate(
        { user: userId, date: today },
        { $inc: { count: -1 } },
      );
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await CoinTransaction.create({
      user: userId,
      amount: adRewardAmount,
      balance: user.coins,
      type: "ad_reward",
    });

    res.json({
      success: true,
      earned: adRewardAmount,
      newBalance: user.coins,
      remaining,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
