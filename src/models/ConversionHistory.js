"use strict";
const mongoose = require("mongoose");
const { ALL_TOOLS } = require("../config/constants");

const conversionHistorySchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  sessionId: { type: String, index: true },
  tool: { type: String, required: true, enum: ALL_TOOLS },
  status: { type: String, enum: ["pending","processing","completed","failed","cancelled"], default: "pending" },

  inputFiles: [{ originalName: String, size: Number, mimeType: String }],
  outputFile: { fileName: String, size: Number, url: String },

  errorMessage:     String,
  processingTimeMs: Number,
  ipAddress:        String,

  // Async job reference
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job" },

  // AI-specific metadata
  aiTokensUsed: Number,

  // File sizes for analytics
  inputSizeBytes:  Number,
  outputSizeBytes: Number,
}, { timestamps: true });

conversionHistorySchema.index({ user: 1, createdAt: -1 });
conversionHistorySchema.index({ tool: 1, createdAt: -1 });
conversionHistorySchema.index({ status: 1 });

// TTL: 30 days
conversionHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 2_592_000 });

module.exports = mongoose.model("ConversionHistory", conversionHistorySchema);
