"use strict";
const SharedResume = require("../models/SharedResume");
const { nanoid } = require("nanoid");

// POST /api/share/resume  — create or replace a shared snapshot for the active user+resumeId
exports.publishResume = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { resumeId, snapshot, name } = req.body;

    if (!resumeId || !snapshot) {
      return res.status(400).json({ success: false, message: "resumeId and snapshot required" });
    }

    // Reuse existing slug for this resume if already published
    let shared = await SharedResume.findOne({ userId, resumeId });
    if (shared) {
      shared.snapshot = snapshot;
      shared.name = name || shared.name;
      shared.isActive = true;
      await shared.save();
    } else {
      const slug = nanoid(10).toLowerCase().replace(/[^a-z0-9]/g, "x");
      shared = await SharedResume.create({ slug, userId, resumeId, snapshot, name: name || "My Resume" });
    }

    return res.json({ success: true, data: { slug: shared.slug, url: `/r/${shared.slug}` } });
  } catch (err) { next(err); }
};

// DELETE /api/share/resume/:resumeId  — unpublish
exports.unpublishResume = async (req, res, next) => {
  try {
    await SharedResume.findOneAndUpdate(
      { userId: req.user._id, resumeId: req.params.resumeId },
      { isActive: false }
    );
    return res.json({ success: true });
  } catch (err) { next(err); }
};

// GET /api/share/resume/:resumeId/status  — check if published + get slug
exports.getShareStatus = async (req, res, next) => {
  try {
    const shared = await SharedResume.findOne({ userId: req.user._id, resumeId: req.params.resumeId });
    if (!shared || !shared.isActive) return res.json({ success: true, data: { published: false } });
    return res.json({ success: true, data: { published: true, slug: shared.slug, views: shared.views } });
  } catch (err) { next(err); }
};

// GET /api/share/views  — view counts for all published resumes owned by user
exports.getMyViews = async (req, res, next) => {
  try {
    const docs = await SharedResume.find({ userId: req.user._id }).select("resumeId views slug isActive").lean();
    const map  = {};
    for (const d of docs) map[d.resumeId] = { views: d.views, slug: d.slug, published: d.isActive };
    return res.json({ success: true, data: map });
  } catch (err) { next(err); }
};

// GET /api/public/r/:slug  — public resume view (no auth)
exports.getPublicResume = async (req, res, next) => {
  try {
    const shared = await SharedResume.findOne({ slug: req.params.slug, isActive: true });
    if (!shared) return res.status(404).json({ success: false, message: "Resume not found or unpublished" });
    shared.views += 1;
    await shared.save();
    return res.json({ success: true, data: { snapshot: shared.snapshot, name: shared.name, views: shared.views } });
  } catch (err) { next(err); }
};
