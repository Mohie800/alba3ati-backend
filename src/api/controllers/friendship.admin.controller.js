const Friendship = require("../models/friendship.model");
const User = require("../models/user.model");

exports.getPlayerFriends = async (req, res) => {
  try {
    const userId = req.params.id;

    const friendships = await Friendship.find({
      status: "accepted",
      $or: [{ requester: userId }, { recipient: userId }],
    })
      .populate("requester", "name frame stats")
      .populate("recipient", "name frame stats")
      .sort({ acceptedAt: -1 })
      .lean();

    const friends = friendships.map((f) => {
      const isRequester = f.requester._id.toString() === userId;
      const friend = isRequester ? f.recipient : f.requester;
      return {
        friendshipId: f._id,
        _id: friend._id,
        name: friend.name,
        frame: friend.frame,
        stats: friend.stats,
        since: f.acceptedAt,
      };
    });

    res.json({
      success: true,
      data: { friends, total: friends.length },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.removeFriendship = async (req, res) => {
  try {
    const friendship = await Friendship.findById(req.params.id);
    if (!friendship) {
      return res
        .status(404)
        .json({ success: false, message: "Friendship not found" });
    }

    if (friendship.status === "accepted") {
      await User.bulkWrite([
        {
          updateOne: {
            filter: { _id: friendship.requester },
            update: { $inc: { friendCount: -1 } },
          },
        },
        {
          updateOne: {
            filter: { _id: friendship.recipient },
            update: { $inc: { friendCount: -1 } },
          },
        },
      ]);
    }

    await friendship.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getFriendshipStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalFriendships,
      totalBlocks,
      pendingRequests,
      friendshipsToday,
      recentRequests,
      topConnected,
    ] = await Promise.all([
      Friendship.countDocuments({ status: "accepted" }),
      Friendship.countDocuments({ status: "blocked" }),
      Friendship.countDocuments({ status: "pending" }),
      Friendship.countDocuments({
        status: "accepted",
        acceptedAt: { $gte: today },
      }),
      Friendship.find({ status: "pending" })
        .populate("requester", "name")
        .populate("recipient", "name")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      User.find({ friendCount: { $gt: 0 } })
        .select("name friendCount")
        .sort({ friendCount: -1 })
        .limit(5)
        .lean(),
    ]);

    res.json({
      success: true,
      data: {
        totalFriendships,
        totalBlocks,
        pendingRequests,
        friendshipsToday,
        recentRequests,
        topConnected,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
