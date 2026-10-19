const path = require("path");
const fs = require("fs");
const Announcement = require("../models/announcement.model");

const FREQUENCIES = ["once", "every_open"];
const ACTION_TYPES = ["url", "screen"];

function removeImage(imageUrl) {
  if (!imageUrl) return;
  const filePath = path.join(process.cwd(), imageUrl);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// Multipart bodies arrive as strings; normalize them onto the doc
function applyFields(doc, body) {
  const str = (v) => (typeof v === "string" ? v.trim() : v);
  if (body.title !== undefined) doc.title = str(body.title);
  if (body.body !== undefined) doc.body = str(body.body) || "";
  if (body.buttonText !== undefined) doc.buttonText = str(body.buttonText) || null;
  if (body.buttonActionType !== undefined || body.buttonActionValue !== undefined) {
    const type = ACTION_TYPES.includes(body.buttonActionType)
      ? body.buttonActionType
      : null;
    doc.buttonAction = {
      type,
      value: type ? str(body.buttonActionValue) || null : null,
    };
  }
  if (FREQUENCIES.includes(body.frequency)) doc.frequency = body.frequency;
  if (body.isActive !== undefined) {
    doc.isActive = body.isActive === true || body.isActive === "true";
  }
  if (body.priority !== undefined) {
    const n = parseInt(body.priority, 10);
    doc.priority = Number.isFinite(n) ? n : 0;
  }
  for (const key of ["startsAt", "endsAt"]) {
    if (body[key] !== undefined) {
      doc[key] = body[key] && !isNaN(Date.parse(body[key])) ? new Date(body[key]) : null;
    }
  }
}

function validate(doc) {
  if (!doc.title) return "Title is required";
  if (doc.buttonText && !doc.buttonAction?.type) {
    return "A button needs an action (link or screen)";
  }
  if (doc.buttonAction?.type && !doc.buttonText) return "Button text is required";
  if (doc.buttonAction?.type && !doc.buttonAction.value) {
    return "Button action value is required";
  }
  if (doc.startsAt && doc.endsAt && doc.endsAt <= doc.startsAt) {
    return "End date must be after start date";
  }
  return null;
}

exports.create = async (req, res) => {
  try {
    const doc = new Announcement({ createdBy: req.admin?.id || null });
    applyFields(doc, req.body);
    if (req.file) doc.imageUrl = "/uploads/announcements/" + req.file.filename;
    const error = validate(doc);
    if (error) {
      if (req.file) removeImage(doc.imageUrl);
      return res.status(400).json({ success: false, message: error });
    }
    await doc.save();
    res.status(201).json({ success: true, data: { announcement: doc } });
  } catch (err) {
    console.error("Create announcement error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /api/admin/announcements?status=live|scheduled|ended|inactive&search=&page=
exports.list = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const now = new Date();
    const filter = {};
    switch (req.query.status) {
      case "live":
        Object.assign(filter, liveFilter(now));
        break;
      case "scheduled":
        filter.isActive = true;
        filter.startsAt = { $gt: now };
        break;
      case "ended":
        filter.endsAt = { $lte: now };
        break;
      case "inactive":
        filter.isActive = false;
        break;
    }
    if (req.query.search && req.query.search.trim()) {
      const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { title: { $regex: escaped, $options: "i" } },
            { body: { $regex: escaped, $options: "i" } },
          ],
        },
      ];
    }
    const [announcements, total] = await Promise.all([
      Announcement.find(filter)
        .sort({ priority: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Announcement.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: { announcements, page, pages: Math.ceil(total / limit), total },
    });
  } catch (err) {
    console.error("List announcements error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.update = async (req, res) => {
  try {
    const doc = await Announcement.findById(req.params.id);
    if (!doc) {
      if (req.file) removeImage("/uploads/announcements/" + req.file.filename);
      return res.status(404).json({ success: false, message: "Not found" });
    }
    const oldImage = doc.imageUrl;
    applyFields(doc, req.body);
    if (req.file) {
      doc.imageUrl = "/uploads/announcements/" + req.file.filename;
    } else if (req.body.removeImage === "true" || req.body.removeImage === true) {
      doc.imageUrl = null;
    }
    const error = validate(doc);
    if (error) {
      if (req.file) removeImage(doc.imageUrl);
      return res.status(400).json({ success: false, message: error });
    }
    await doc.save();
    if (oldImage && oldImage !== doc.imageUrl) removeImage(oldImage);
    res.json({ success: true, data: { announcement: doc } });
  } catch (err) {
    console.error("Update announcement error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.remove = async (req, res) => {
  try {
    const doc = await Announcement.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    removeImage(doc.imageUrl);
    await Announcement.deleteOne({ _id: doc._id });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete announcement error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

function liveFilter(now) {
  return {
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
    ],
  };
}

// Public: GET /api/app/announcements — live ones, highest priority first
exports.getLive = async (req, res) => {
  try {
    const announcements = await Announcement.find(liveFilter(new Date()))
      .select("title body imageUrl buttonText buttonAction frequency updatedAt")
      .sort({ priority: -1, createdAt: -1 })
      .limit(10)
      .lean();
    res.json({ success: true, data: { announcements } });
  } catch (err) {
    console.error("Get live announcements error:", err);
    res.json({ success: true, data: { announcements: [] } });
  }
};
