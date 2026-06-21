"use strict";

const logger = require("./logger");

// Jobs stuck in "processing" for longer than this are considered dead
const PROCESSING_TIMEOUT_MS = 30 * 60 * 1_000; // 30 minutes
// Jobs stuck in "queued" with no worker for longer than this are expired
const QUEUED_TIMEOUT_MS = 2 * 60 * 60 * 1_000; // 2 hours

/**
 * On server startup, recover jobs that were interrupted by a crash or restart.
 *
 * - processing jobs older than PROCESSING_TIMEOUT_MS → failed
 * - queued   jobs older than QUEUED_TIMEOUT_MS        → failed
 */
const recoverStuckJobs = async () => {
  try {
    const Job = require("../models/Job");

    const now = Date.now();

    // Recover stuck processing jobs
    const processingCutoff = new Date(now - PROCESSING_TIMEOUT_MS);
    const processingResult = await Job.updateMany(
      { status: "processing", startedAt: { $lt: processingCutoff } },
      {
        $set: {
          status: "failed",
          errorMessage:
            "Job was interrupted by a server restart. Please try again.",
          progress: 0,
        },
      },
    );
    if (processingResult.modifiedCount > 0) {
      logger.warn(
        `[JobRecovery] Recovered ${processingResult.modifiedCount} stuck processing job(s) to failed state`,
      );
    }

    // Expire stale queued jobs (never picked up by a worker)
    const queuedCutoff = new Date(now - QUEUED_TIMEOUT_MS);
    const queuedResult = await Job.updateMany(
      { status: "queued", queuedAt: { $lt: queuedCutoff } },
      {
        $set: {
          status: "failed",
          errorMessage:
            "Job expired from the queue without being processed. Please try again.",
          progress: 0,
        },
      },
    );
    if (queuedResult.modifiedCount > 0) {
      logger.warn(
        `[JobRecovery] Expired ${queuedResult.modifiedCount} stale queued job(s)`,
      );
    }

    const total = processingResult.modifiedCount + queuedResult.modifiedCount;
    if (total === 0) {
      logger.info("[JobRecovery] No stuck jobs found.");
    }
  } catch (err) {
    // Non-fatal: if DB is unavailable at startup, log and continue
    logger.error("[JobRecovery] Failed to recover stuck jobs:", err.message);
  }
};

module.exports = { recoverStuckJobs };
