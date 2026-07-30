"use strict";
const mongoose = require("mongoose");

const portfolioSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    username: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 50,
                match: /^[a-z0-9_-]{3,50}$/ },
    isPublic: { type: Boolean, default: true },

    // Profile
    displayName: { type: String, trim: true, maxlength: 100 },
    tagline:     { type: String, trim: true, maxlength: 200 },
    about:       { type: String, trim: true, maxlength: 2000 },
    photoUrl:    { type: String, trim: true, maxlength: 500 },
    location:    { type: String, trim: true, maxlength: 100 },
    email:       { type: String, trim: true, maxlength: 200 },
    phone:       { type: String, trim: true, maxlength: 30 },

    // Social links
    social: {
      linkedin:  { type: String, trim: true, maxlength: 300 },
      github:    { type: String, trim: true, maxlength: 300 },
      twitter:   { type: String, trim: true, maxlength: 300 },
      website:   { type: String, trim: true, maxlength: 300 },
      youtube:   { type: String, trim: true, maxlength: 300 },
    },

    // Skills
    skills: [{ name: { type: String, trim: true }, level: { type: String, enum: ["beginner","intermediate","advanced","expert"], default: "intermediate" } }],

    // Projects
    projects: [
      {
        title:       { type: String, trim: true, maxlength: 200 },
        description: { type: String, trim: true, maxlength: 1000 },
        url:         { type: String, trim: true, maxlength: 300 },
        githubUrl:   { type: String, trim: true, maxlength: 300 },
        imageUrl:    { type: String, trim: true, maxlength: 500 },
        tags:        [{ type: String, trim: true }],
        featured:    { type: Boolean, default: false },
      },
    ],

    // Pinned resume (public slug)
    pinnedResumeId: { type: String },

    // SEO
    metaTitle:       { type: String, trim: true, maxlength: 100 },
    metaDescription: { type: String, trim: true, maxlength: 300 },

    views: { type: Number, default: 0 },

    // ── Section-based builder (v2) ──────────────────────────────────────────
    // Ordered, typed sections. `config` is intentionally untyped (Mixed) so new
    // section types/fields can be added later without a schema migration.
    sections: [
      {
        _id:     false,
        id:      { type: String, required: true },
        type:    { type: String, required: true, enum: ["hero", "about", "skills", "experience", "projects", "education", "testimonials", "contact"] },
        enabled: { type: Boolean, default: true },
        // Redundant with array position (the frontend doesn't send this) — stamped
        // server-side in the controller from array index before every save.
        order:   { type: Number, default: 0 },
        config:  { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],

    theme: {
      templateId:  { type: String, default: "minimal" },
      accentColor: { type: String, default: "#4f46e5" },
      fontFamily:  { type: String, enum: ["inter", "poppins", "georgia", "jetbrains-mono"], default: "inter" },
      mode:        { type: String, enum: ["light", "dark"], default: "dark" },
      layoutWidth: { type: String, enum: ["narrow", "wide"], default: "wide" },
      radius:      { type: String, enum: ["sharp", "rounded", "pill"], default: "rounded" },
    },

    // draft vs published: owner always edits `draft`; the public page always
    // reads `published`. Publishing is a one-way copy from draft -> published.
    status:      { type: String, enum: ["draft", "published"], default: "draft" },
    draft:       { type: mongoose.Schema.Types.Mixed },
    published:   { type: mongoose.Schema.Types.Mixed },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

// username and userId already indexed via unique:true in field definitions above

module.exports = mongoose.model("Portfolio", portfolioSchema);
