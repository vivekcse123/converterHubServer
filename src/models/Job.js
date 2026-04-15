"use strict";
const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    sessionId: { type: String, index: true },
    tool: { type: String, required: true },
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed", "cancelled"],
      default: "queued",
      index: true,
    },
    priority: { type: Number, default: 0 },
    progress: { type: Number, default: 0, min: 0, max: 100 },

    // Input/output
    inputFiles: [
      {
        originalName: String,
        storedName: String,
        path: String,
        size: Number,
        mimeType: String,
      },
    ],
    outputFiles: [
      {
        fileName: String,
        path: String,
        url: String,
        size: Number,
      },
    ],
    options: { type: mongoose.Schema.Types.Mixed, default: {} },

    // BullMQ reference
    bullJobId: String,
    queueName: String,

    // Timing & errors
    queuedAt: { type: Date, default: Date.now },
    startedAt: Date,
    completedAt: Date,
    processingTimeMs: Number,
    errorMessage: String,
    retryCount: { type: Number, default: 0 },

    // Metadata
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true },
);

jobSchema.index({ user: 1, createdAt: -1 });
jobSchema.index({ status: 1, queuedAt: 1 });

// Auto-delete completed/failed jobs after 7 days
jobSchema.index(
  { completedAt: 1 },
  {
    expireAfterSeconds: 604_800,
    partialFilterExpression: { status: { $in: ["completed", "failed"] } },
  },
);

module.exports = mongoose.model("Job", jobSchema);
