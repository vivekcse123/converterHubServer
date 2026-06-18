"use strict";
const mongoose = require("mongoose");

const jobApplicationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    jobTitle:    { type: String, required: true, trim: true, maxlength: 200 },
    company:     { type: String, required: true, trim: true, maxlength: 200 },
    location:    { type: String, trim: true, maxlength: 200 },
    jobUrl:      { type: String, trim: true, maxlength: 1000 },
    salary:      { type: String, trim: true, maxlength: 100 },
    status: {
      type: String,
      enum: ["saved", "applied", "interviewing", "offer", "rejected", "withdrawn"],
      default: "applied",
      index: true,
    },
    appliedDate:   { type: Date, default: Date.now },
    deadlineDate:  { type: Date },
    notes:         { type: String, trim: true, maxlength: 2000 },
    resumeId:      { type: String }, // local resume ID used
    coverLetterId: { type: String },
    contacts: [
      {
        name:  { type: String, trim: true },
        role:  { type: String, trim: true },
        email: { type: String, trim: true },
        phone: { type: String, trim: true },
      },
    ],
    timeline: [
      {
        event:     { type: String, trim: true },
        date:      { type: Date, default: Date.now },
        note:      { type: String, trim: true },
      },
    ],
    matchScore: { type: Number, min: 0, max: 100 },
    tags: [{ type: String, trim: true, maxlength: 50 }],
  },
  { timestamps: true }
);

jobApplicationSchema.index({ userId: 1, status: 1 });
jobApplicationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("JobApplication", jobApplicationSchema);
