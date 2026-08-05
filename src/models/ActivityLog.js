"use strict";
const mongoose = require("mongoose");

// Admin-action audit trail. actor/target fields are denormalized (email,
// role, label snapshotted at write time) so entries stay readable even if
// the actor or target document is later deleted — no populate needed to
// render the list, which also keeps this fast under load.
const activityLogSchema = new mongoose.Schema(
  {
    actorId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorEmail: String,
    actorRole:  String,
    action:     { type: String, required: true, index: true }, // e.g. "user.ban", "portfolio.feature"
    targetType: { type: String, index: true },                 // "User" | "Portfolio" | "Payment" | "Plan" | "SiteConfig"
    targetId:   { type: mongoose.Schema.Types.ObjectId, index: true },
    targetLabel: String,
    metadata:   { type: mongoose.Schema.Types.Mixed, default: {} },
    ipAddress:  String,
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ actorId: 1, createdAt: -1 });
activityLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
