"use strict";
const Redis  = require("ioredis");
const logger = require("../utils/logger");

let connection  = null;
let subscriber  = null;
let redisUp     = null; // null = unknown, true/false after probe

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const createConnection = () => {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck:     false,
    lazyConnect:          true,
    // Stop auto-reconnecting after Redis proves unavailable
    retryStrategy: (times) => {
      if (redisUp === false) return null; // give up immediately
      if (times > 3) {
        redisUp = false;
        logger.warn("Redis unavailable — running in sync mode (no queue).");
        return null; // stop retrying
      }
      return Math.min(times * 500, 2000);
    },
  });

  client.on("error",   () => {}); // suppress repeated error logs after initial warning
  client.on("connect", () => { redisUp = true;  logger.info("Redis connected"); });
  client.on("close",   () => {});
  return client;
};

const getRedisConnection = () => {
  if (!connection) connection = createConnection();
  return connection;
};

const getSubscriberConnection = () => {
  if (!subscriber) subscriber = createConnection();
  return subscriber;
};

const isRedisAvailable = async () => {
  if (redisUp !== null) return redisUp;
  try {
    const client = getRedisConnection();
    await client.connect();
    await client.ping();
    redisUp = true;
    return true;
  } catch {
    redisUp = false;
    return false;
  }
};

module.exports = { getRedisConnection, getSubscriberConnection, isRedisAvailable };
