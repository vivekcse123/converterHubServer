"use strict";
const mongoose = require("mongoose");

// Persists every deep ATS analysis so reopening a report is instant (no
// re-running Gemini, no re-spending the user's daily scan quota). Anonymous
// scans are allowed (userId is nullable) — the checker stays usable without
// login, matching its existing SEO/growth-page behavior; see the ATS
// resume-checker rebuild plan for the quota rationale.
const atsReportSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    fileName: String,
    resumeText: { type: String, required: true },

    overallScore: { type: Number, required: true },
    sectionScores: {
      atsCompatibility: Number, formatting: Number, grammar: Number, spelling: Number,
      structure: Number, readability: Number, keywords: Number, achievements: Number,
      experience: Number, projects: Number, skills: Number, length: Number,
    },

    sectionsDetected: [String],
    sectionsMissing: [{ name: String, impact: String, recommendation: String }],

    contactInfo: {
      email: String, phone: String, linkedin: String, github: String, portfolio: String,
      issues: [String],
    },

    // Unified issue list — category is a discriminator the frontend's Action
    // Center filters on. `quote` is a short exact substring of resumeText,
    // used to locate + highlight the issue inline (string search, not
    // AI-guessed character offsets, which are unreliable).
    issues: [{
      id: String,
      category: {
        type: String,
        enum: ["grammar", "spelling", "weak-verb", "duplicate", "long-sentence", "vague",
               "passive-voice", "formatting", "ats", "keywords"],
      },
      severity: { type: String, enum: ["critical", "high", "medium", "low"] },
      quote: String,
      explanation: String,
      suggestion: String,
      scoreImpact: Number,
    }],

    achievementStats: {
      quantifiedCount: Number, totalBullets: Number,
      strongCount: Number, moderateCount: Number, weakCount: Number,
    },

    // Computed in JS from the extracted text, not asked of the AI — exact
    // counts, zero cost, and immune to LLM counting mistakes.
    lengthStats: {
      wordCount: Number, bulletCount: Number, pageEstimate: Number, readingTimeSec: Number,
    },

    strengths: [String],
    weaknesses: [String],
    recruiterSummary: {
      verdict: { type: String, enum: ["ready", "borderline", "needs-work"] },
      notes: String,
    },
  },
  { timestamps: true }
);

atsReportSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("AtsReport", atsReportSchema);
