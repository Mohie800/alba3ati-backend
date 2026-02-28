const Ad = require("../models/ad.model");
const path = require("path");
const fs = require("fs");

exports.createAd = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Image is required" });
    }

    const { title, link } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: "Title is required" });
    }

    const ad = await Ad.create({
      title,
      imageUrl: "/uploads/ads/" + req.file.filename,
      link: link || null,
      createdBy: req.admin.id,
    });

    res.status(201).json({ success: true, data: { ad } });
  } catch (err) {
    console.error("Create ad error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getAds = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [ads, total] = await Promise.all([
      Ad.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
      Ad.countDocuments(),
    ]);

    res.json({
      success: true,
      data: {
        ads,
        page,
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (err) {
    console.error("Get ads error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.updateAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    const { title, link, isActive } = req.body;
    if (title !== undefined) ad.title = title;
    if (link !== undefined) ad.link = link || null;
    if (isActive !== undefined) ad.isActive = isActive === "true" || isActive === true;

    // Replace image if a new one was uploaded
    if (req.file) {
      // Delete old image
      const oldPath = path.join(process.cwd(), ad.imageUrl);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
      ad.imageUrl = "/uploads/ads/" + req.file.filename;
    }

    await ad.save();
    res.json({ success: true, data: { ad } });
  } catch (err) {
    console.error("Update ad error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteAd = async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) {
      return res.status(404).json({ success: false, message: "Ad not found" });
    }

    // Delete image file
    const imagePath = path.join(process.cwd(), ad.imageUrl);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    await Ad.deleteOne({ _id: ad._id });
    res.json({ success: true, message: "Ad deleted" });
  } catch (err) {
    console.error("Delete ad error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getActiveAds = async (req, res) => {
  try {
    const ads = await Ad.find({ isActive: true })
      .select("title imageUrl link")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: { ads } });
  } catch (err) {
    console.error("Get active ads error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
