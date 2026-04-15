"use strict";
const { Queue, Worker, QueueEvents } = require("bullmq");
const { getRedisConnection } = require("../config/redis");
const logger = require("../utils/logger");

let conversionQueue = null;
let queueEvents = null;
let isQueueAvailable = false;

const QUEUE_NAME = "conversion";

const initQueue = async () => {
  try {
    const connection = getRedisConnection();
    conversionQueue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      },
    });
    queueEvents = new QueueEvents(QUEUE_NAME, { connection });
    isQueueAvailable = true;
    logger.info("BullMQ queue initialized");
    return true;
  } catch (err) {
    logger.warn(
      "Queue unavailable (Redis offline) — running in sync mode:",
      err.message,
    );
    isQueueAvailable = false;
    return false;
  }
};

const addJob = async (tool, data, opts = {}) => {
  if (!isQueueAvailable || !conversionQueue) {
    return null; // Caller falls back to synchronous processing
  }
  const job = await conversionQueue.add(tool, data, {
    priority: opts.priority ?? 0,
    delay: opts.delay ?? 0,
    jobId: opts.jobId,
  });
  logger.debug(`Job ${job.id} queued for tool: ${tool}`);
  return job;
};

const getJob = async (jobId) => {
  if (!conversionQueue) return null;
  return conversionQueue.getJob(jobId);
};

const retryJob = async (jobId) => {
  const job = await getJob(jobId);
  if (job) await job.retry();
  return job;
};

const removeJob = async (jobId) => {
  const job = await getJob(jobId);
  if (job) await job.remove();
};

const getQueueStats = async () => {
  if (!conversionQueue) return null;
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    conversionQueue.getWaitingCount(),
    conversionQueue.getActiveCount(),
    conversionQueue.getCompletedCount(),
    conversionQueue.getFailedCount(),
    conversionQueue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
};

const getActiveJobs = async () => {
  if (!conversionQueue) return [];
  return conversionQueue.getActive();
};

const getWaitingJobs = async () => {
  if (!conversionQueue) return [];
  return conversionQueue.getWaiting();
};

const getFailedJobs = async (start = 0, end = 49) => {
  if (!conversionQueue) return [];
  return conversionQueue.getFailed(start, end);
};

const getQueue = () => conversionQueue;
const getQueueEvents = () => queueEvents;

module.exports = {
  initQueue,
  addJob,
  getJob,
  retryJob,
  removeJob,
  getQueueStats,
  getActiveJobs,
  getWaitingJobs,
  getFailedJobs,
  getQueue,
  getQueueEvents,
  get isAvailable() {
    return isQueueAvailable;
  },
};
