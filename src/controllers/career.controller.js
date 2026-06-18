"use strict";
const JobApplication = require("../models/JobApplication");
const Portfolio      = require("../models/Portfolio");
const { success, error, paginated } = require("../utils/response");

// ── Job Tracker ───────────────────────────────────────────────────────────────

// GET /api/career/jobs
const getJobs = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const filter = { userId: req.user._id };
    if (status) filter.status = status;
    if (search) {
      const q = search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { jobTitle: { $regex: q, $options: "i" } },
        { company:  { $regex: q, $options: "i" } },
      ];
    }
    const skip = (Math.max(1, +page) - 1) * Math.min(100, +limit);
    const [jobs, total] = await Promise.all([
      JobApplication.find(filter).sort({ createdAt: -1 }).skip(skip).limit(+limit).lean(),
      JobApplication.countDocuments(filter),
    ]);
    const counts = await JobApplication.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const statusCounts = Object.fromEntries(counts.map(c => [c._id, c.count]));
    paginated(res, jobs, total, +page, +limit, { statusCounts });
  } catch (err) { next(err); }
};

// POST /api/career/jobs
const createJob = async (req, res, next) => {
  try {
    const { jobTitle, company, location, jobUrl, salary, status, appliedDate, deadlineDate, notes, resumeId, tags } = req.body;
    if (!jobTitle || !company) return error(res, "Job title and company are required", 400);
    const job = await JobApplication.create({
      userId: req.user._id, jobTitle, company, location, jobUrl, salary,
      status: status || "applied", appliedDate, deadlineDate, notes, resumeId, tags,
    });
    success(res, { job }, "Application added", 201);
  } catch (err) { next(err); }
};

// PATCH /api/career/jobs/:id
const updateJob = async (req, res, next) => {
  try {
    const job = await JobApplication.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!job) return error(res, "Application not found", 404);
    success(res, { job });
  } catch (err) { next(err); }
};

// DELETE /api/career/jobs/:id
const deleteJob = async (req, res, next) => {
  try {
    const job = await JobApplication.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!job) return error(res, "Application not found", 404);
    success(res, {}, "Deleted");
  } catch (err) { next(err); }
};

// POST /api/career/jobs/:id/timeline
const addTimeline = async (req, res, next) => {
  try {
    const { event, note } = req.body;
    const job = await JobApplication.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $push: { timeline: { event, note, date: new Date() } } },
      { new: true }
    );
    if (!job) return error(res, "Application not found", 404);
    success(res, { job });
  } catch (err) { next(err); }
};

// ── Portfolio ─────────────────────────────────────────────────────────────────

// GET /api/career/portfolio  (own)
const getPortfolio = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findOne({ userId: req.user._id }).lean();
    success(res, { portfolio });
  } catch (err) { next(err); }
};

// PUT /api/career/portfolio  (create or update)
const upsertPortfolio = async (req, res, next) => {
  try {
    const { username } = req.body;
    if (username) {
      // Check username not taken by another user
      const existing = await Portfolio.findOne({ username, userId: { $ne: req.user._id } });
      if (existing) return error(res, "Username already taken", 409);
    }
    const portfolio = await Portfolio.findOneAndUpdate(
      { userId: req.user._id },
      { ...req.body, userId: req.user._id },
      { new: true, upsert: true, runValidators: true }
    );
    success(res, { portfolio });
  } catch (err) { next(err); }
};

// GET /api/career/portfolio/check-username/:username  (public)
const checkUsername = async (req, res, next) => {
  try {
    const taken = !!(await Portfolio.findOne({ username: req.params.username }));
    success(res, { username: req.params.username, available: !taken });
  } catch (err) { next(err); }
};

// GET /api/public/portfolio/:username  (public, no auth)
const getPublicPortfolio = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findOne({ username: req.params.username, isPublic: true }).lean();
    if (!portfolio) return error(res, "Portfolio not found", 404);
    // Increment views
    Portfolio.findByIdAndUpdate(portfolio._id, { $inc: { views: 1 } }).catch(() => {});
    success(res, { portfolio });
  } catch (err) { next(err); }
};

// ── Stats ─────────────────────────────────────────────────────────────────────

// GET /api/career/stats
const getCareerStats = async (req, res, next) => {
  try {
    const [counts, recent] = await Promise.all([
      JobApplication.aggregate([
        { $match: { userId: req.user._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      JobApplication.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    const statusCounts = Object.fromEntries(counts.map(c => [c._id, c.count]));
    success(res, { statusCounts, recent, total: Object.values(statusCounts).reduce((a, b) => a + b, 0) });
  } catch (err) { next(err); }
};

module.exports = { getJobs, createJob, updateJob, deleteJob, addTimeline, getPortfolio, upsertPortfolio, checkUsername, getPublicPortfolio, getCareerStats };
