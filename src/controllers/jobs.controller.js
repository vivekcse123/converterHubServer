"use strict";
const Job = require("../models/Job");
const { success, error, paginated } = require("../utils/response");
const queueService = require("../services/queue.service");
const { deleteFile } = require("../utils/fileCleanup");

// GET /api/jobs  — current user's jobs
const getUserJobs = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;
    const filter = {};
    if (req.user) filter.user = req.user._id;
    else if (req.headers["x-session-id"])
      filter.sessionId = req.headers["x-session-id"];
    else return paginated(res, [], 0, 1, 10);

    const [jobs, total] = await Promise.all([
      Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Job.countDocuments(filter),
    ]);
    paginated(res, jobs, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// GET /api/jobs/:id  — single job status
const getJob = async (req, res, next) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user) filter.user = req.user._id;
    const job = await Job.findOne(filter).lean();
    if (!job) return error(res, "Job not found", 404);

    // If using BullMQ, enhance with real-time progress
    if (job.bullJobId && queueService.isAvailable) {
      const bullJob = await queueService.getJob(job.bullJobId);
      if (bullJob) {
        job.bullProgress = await bullJob.progress;
        job.bullState = await bullJob.getState();
      }
    }
    success(res, { job });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/jobs/:id  — cancel a queued job
const cancelJob = async (req, res, next) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user) filter.user = req.user._id;
    const job = await Job.findOne(filter);
    if (!job) return error(res, "Job not found", 404);
    if (!["queued", "processing"].includes(job.status))
      return error(res, "Only queued or processing jobs can be cancelled", 400);

    if (job.bullJobId && queueService.isAvailable) {
      await queueService.removeJob(job.bullJobId).catch(() => {});
    }
    await Job.findByIdAndUpdate(job._id, { status: "cancelled" });
    // Clean up input files
    for (const f of job.inputFiles || []) {
      if (f.path) deleteFile(f.path);
    }
    success(res, {}, "Job cancelled");
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/jobs  — admin: all jobs
const getAllJobs = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const status = req.query.status;
    const filter = {};
    if (status) filter.status = status;

    const [jobs, total] = await Promise.all([
      Job.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "name email")
        .lean(),
      Job.countDocuments(filter),
    ]);
    paginated(res, jobs, total, page, limit);
  } catch (err) {
    next(err);
  }
};

module.exports = { getUserJobs, getJob, cancelJob, getAllJobs };
