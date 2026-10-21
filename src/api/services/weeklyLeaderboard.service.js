const User = require("../models/user.model");
const WeeklyScore = require("../models/weeklyScore.model");
const WeeklyResult = require("../models/weeklyResult.model");
const CoinTransaction = require("../models/coinTransaction.model");
const AppSettings = require("../models/appSettings.model");
const { sendPushNotification } = require("./pushNotification.service");

// Weeks run Saturday 00:00 → Friday 23:59 in the players' local time
const WEEK_TZ = "Africa/Khartoum";
const DAY_MS = 24 * 60 * 60 * 1000;
// Lets games that ended right before midnight finish writing before the week is closed
const PAYOUT_DELAY_MS = 60 * 1000;
const PAYOUT_CHECK_MS = 5 * 60 * 1000;
const RANK_LABELS = { 1: "الأول", 2: "الثاني", 3: "الثالث" };

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: WEEK_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function tzOffsetMs(date) {
  const p = Object.fromEntries(
    partsFmt.formatToParts(date).map((x) => [x.type, x.value]),
  );
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - (date.getTime() - (date.getTime() % 1000));
}

// "YYYY-MM-DD" of the Saturday that starts the week containing `date`
function weekKey(date = new Date()) {
  const local = new Date(date.getTime() + tzOffsetMs(date));
  const sinceSaturday = (local.getUTCDay() + 1) % 7;
  const start = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - sinceSaturday,
  );
  return new Date(start).toISOString().slice(0, 10);
}

function localMidnight(dayMs) {
  return new Date(dayMs - tzOffsetMs(new Date(dayMs)));
}

function weekBounds(key) {
  const start = Date.parse(`${key}T00:00:00Z`);
  return { startsAt: localMidnight(start), endsAt: localMidnight(start + 7 * DAY_MS) };
}

function previousWeekKey(key) {
  return new Date(Date.parse(`${key}T00:00:00Z`) - 7 * DAY_MS).toISOString().slice(0, 10);
}

function rewardAmounts(settings) {
  const cfg = settings.weeklyLeaderboard || {};
  return [cfg.firstReward ?? 500, cfg.secondReward ?? 300, cfg.thirdReward ?? 150];
}

const RANK_SORT = { wins: -1, games: 1, lastWinAt: 1, _id: 1 };

// entries: [{ playerId, won, finished }] — a leaver's game counts but its win doesn't
async function recordWeeklyGame(entries) {
  if (!entries.length) return;
  const week = weekKey();
  const now = new Date();
  const ops = entries.map(({ playerId, won, finished }) => {
    const win = won && finished;
    const update = { $inc: { games: 1, wins: win ? 1 : 0 } };
    if (win) update.$set = { lastWinAt: now };
    return {
      updateOne: { filter: { week, user: playerId }, update, upsert: true },
    };
  });
  await WeeklyScore.bulkWrite(ops, { ordered: false });
}

async function getRanking(week, skip, limit) {
  return WeeklyScore.find({ week, wins: { $gt: 0 } })
    .sort(RANK_SORT)
    .skip(skip)
    .limit(limit)
    .populate("user", "name frame nameColor equippedProfilePicture")
    .lean();
}

// 1-based rank of a player in a week; rank is null until their first win
async function getPlayerRank(week, userId) {
  const mine = await WeeklyScore.findOne({ week, user: userId }).lean();
  if (!mine?.wins) return { rank: null, wins: 0, games: mine?.games || 0 };
  const ahead = await WeeklyScore.countDocuments({
    week,
    $or: [
      { wins: { $gt: mine.wins } },
      { wins: mine.wins, games: { $lt: mine.games } },
      { wins: mine.wins, games: mine.games, lastWinAt: { $lt: mine.lastWinAt } },
      {
        wins: mine.wins,
        games: mine.games,
        lastWinAt: mine.lastWinAt,
        _id: { $lt: mine._id },
      },
    ],
  });
  return { rank: ahead + 1, wins: mine.wins, games: mine.games };
}

async function payWinner(result, winner) {
  // Flag flip first so a retry can never pay twice
  const claimed = await WeeklyResult.updateOne(
    { _id: result._id, winners: { $elemMatch: { rank: winner.rank, paid: false } } },
    { $set: { "winners.$.paid": true } },
  );
  if (!claimed.modifiedCount || winner.coins <= 0) return;

  const user = await User.findByIdAndUpdate(
    winner.user,
    { $inc: { coins: winner.coins } },
    { new: true },
  );
  if (!user) return;

  await CoinTransaction.create({
    user: user._id,
    amount: winner.coins,
    balance: user.coins,
    type: "weekly_reward",
    meta: { week: result.week, rank: winner.rank, wins: winner.wins },
  });

  sendPushNotification({
    title: "بطل الأسبوع 🏆",
    body: `مبروك! جيت في المركز ${RANK_LABELS[winner.rank]} في ترتيب الأسبوع بـ ${winner.wins} فوز، وحصلت على ${winner.coins} عملة!`,
    data: { type: "weekly_reward", week: result.week, rank: winner.rank },
    userIds: [user._id],
    type: "targeted",
  }).catch(() => {});
}

// Closes the last finished week once; also resumes a payout interrupted by a restart
async function closeFinishedWeek() {
  const lastWeek = previousWeekKey(weekKey());
  if (Date.now() < weekBounds(lastWeek).endsAt.getTime() + PAYOUT_DELAY_MS) return;

  let result = await WeeklyResult.findOne({ week: lastWeek });
  if (!result) {
    const settings = await AppSettings.getSettings();
    const enabled = settings.weeklyLeaderboard?.enabled !== false;
    const amounts = rewardAmounts(settings);
    const top = enabled ? await getRanking(lastWeek, 0, 3) : [];
    try {
      result = await WeeklyResult.create({
        week: lastWeek,
        winners: top
          .filter((s) => s.user)
          .map((s, i) => ({
            rank: i + 1,
            user: s.user._id,
            wins: s.wins,
            games: s.games,
            coins: amounts[i],
          })),
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      result = await WeeklyResult.findOne({ week: lastWeek });
    }
  }

  for (const winner of result.winners) {
    if (!winner.paid) await payWinner(result, winner);
  }
}

function startWeeklyPayouts() {
  const run = () =>
    closeFinishedWeek().catch((err) => console.error("[Weekly] payout error:", err));
  run();
  setInterval(run, PAYOUT_CHECK_MS).unref();
}

module.exports = {
  weekKey,
  weekBounds,
  previousWeekKey,
  rewardAmounts,
  recordWeeklyGame,
  getRanking,
  getPlayerRank,
  closeFinishedWeek,
  startWeeklyPayouts,
};
