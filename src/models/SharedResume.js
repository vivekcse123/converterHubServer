"use strict";
const mongoose = require("mongoose");

const sharedResumeSchema = new mongoose.Schema(
  {
    slug:     { type: String, required: true, unique: true, lowercase: true, match: /^[a-z0-9-]{6,80}$/ },
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    resumeId: { type: String, required: true },      // localStorage id
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true }, // full ResumeData object
    name:     { type: String, default: "My Resume" },
    views:    { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// slug already indexed via unique:true in field definition above
sharedResumeSchema.index({ userId: 1 });

module.exports = mongoose.model("SharedResume", sharedResumeSchema);
