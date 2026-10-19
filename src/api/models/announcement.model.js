const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, default: "", trim: true },
    imageUrl: { type: String, default: null },
    // Button: "url" opens externally, "screen" navigates in-app (value = route name)
    buttonText: { type: String, default: null, trim: true },
    buttonAction: {
      type: { type: String, enum: ["url", "screen", null], default: null },
      value: { type: String, default: null },
    },
    // "once": a device sees it a single time; "every_open": on every app launch
    frequency: { type: String, enum: ["once", "every_open"], default: "once" },
    isActive: { type: Boolean, default: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    // Higher shows first when several are live
    priority: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true },
);

announcementSchema.index({ isActive: 1, priority: -1 });

module.exports = mongoose.model("Announcement", announcementSchema);
