"use strict";
const Redis = require("ioredis");
const logger = require("../utils/logger");

let connection = null;
let subscriber = null;

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const createConnection = () => {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  client.on("error", (err) => logger.warn("Redis error:", err.message));
  client.on("connect", () => logger.info("Redis connected"));
  client.on("close", () => logger.warn("Redis connection closed"));
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
  try {
    const client = getRedisConnection();
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  }
};

module.exports = {
  getRedisConnection,
  getSubscriberConnection,
  isRedisAvailable,
};
