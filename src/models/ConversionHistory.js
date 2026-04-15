"use strict";

const mongoose = require("mongoose");

const conversionHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    // Anonymous session id for unauthenticated users
    sessionId: {
      type: String,
      index: true,
    },
    tool: {
      type: String,
      required: true,
      enum: [
        "image-to-pdf",
        "pdf-to-word",
        "word-to-pdf",
        "pdf-merge",
        "pdf-split",
        "pdf-compress",
        "image-resize",
        "image-compress",
        "image-convert",
        "text-to-pdf",
        "create-zip",
      ],
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    inputFiles: [
      {
        originalName: String,
        size: Number, // bytes
        mimeType: String,
      },
    ],
    outputFile: {
      fileName: String,
      size: Number,
      url: String,
    },
    errorMessage: String,
    processingTimeMs: Number,
    ipAddress: String,
  },
  {
    timestamps: true,
    // Auto-expire documents after 30 days
    expireAfterSeconds: 2_592_000,
  },
);

// Compound index for user history queries
conversionHistorySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("ConversionHistory", conversionHistorySchema);
