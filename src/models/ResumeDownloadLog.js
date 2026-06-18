"use strict";
const mongoose = require("mongoose");

const resumeDownloadLogSchema = new mongoose.Schema(
  {
    userId:            { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    templateId:        { type: String, required: true },
    templateName:      { type: String },
    isPremiumTemplate: { type: Boolean, default: false },
    planType:          { type: String, enum: ["free", "monthly", "yearly", "admin"], default: "free" },
    action:            { type: String, enum: ["download", "blocked"], default: "download" },
    success:           { type: Boolean, default: true },
    blocked:           { type: Boolean, default: false },
    reason:            { type: String },         // reason if blocked
    ip:                { type: String },
    userAgent:         { type: String },
    resumeName:        { type: String },
  },
  { timestamps: true }
);

resumeDownloadLogSchema.index({ userId: 1, createdAt: -1 });
resumeDownloadLogSchema.index({ createdAt: -1 });
resumeDownloadLogSchema.index({ templateId: 1 });

module.exports = mongoose.model("ResumeDownloadLog", resumeDownloadLogSchema);
