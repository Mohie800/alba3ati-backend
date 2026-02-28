const Contact = require("../models/contact.model");

exports.submitContact = async (req, res) => {
  try {
    const { userId, playerName, subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ success: false, message: "Subject and message required" });
    }

    const contact = await Contact.create({
      player: userId || null,
      playerName: playerName || "Anonymous",
      subject,
      message,
      source: "app",
    });

    res.status(201).json({ success: true, data: { contact } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.submitLandingContact = async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    if (!email && !phone) {
      return res.status(400).json({ success: false, message: "Email or phone is required" });
    }

    const contact = await Contact.create({
      playerName: name || "زائر الموقع",
      email: email || null,
      phone: phone || null,
      subject: "رسالة من الموقع",
      message,
      source: "landing",
    });

    res.status(201).json({ success: true, data: { contact } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getContacts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const source = req.query.source;
    const skip = (page - 1) * limit;

    const query = {};
    if (status) query.status = status;
    if (source) query.source = source;

    const [contacts, total] = await Promise.all([
      Contact.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Contact.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        contacts,
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getContactDetail = async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({ success: false, message: "Contact not found" });
    }

    if (contact.status === "new") {
      contact.status = "read";
      await contact.save();
    }

    res.json({ success: true, data: { contact } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.respondToContact = async (req, res) => {
  try {
    const { response } = req.body;

    if (!response) {
      return res.status(400).json({ success: false, message: "Response is required" });
    }

    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      {
        adminResponse: response,
        status: "responded",
        respondedAt: new Date(),
      },
      { new: true }
    );

    if (!contact) {
      return res.status(404).json({ success: false, message: "Contact not found" });
    }

    res.json({ success: true, data: { contact } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getMyResponses = async (req, res) => {
  try {
    const { userId } = req.params;

    const contacts = await Contact.find({ player: userId })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, data: { contacts } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
