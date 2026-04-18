"use strict";

const cron = require("node-cron");
const https = require("https");
const http = require("http");
const logger = require("./logger");

/**
 * Schedule a self-ping every 10 minutes to keep the server warm
 * on platforms that spin down idle dynos (e.g. Render free tier).
 *
 * Controlled by the SELF_PING_URL environment variable.
 * If the variable is absent the scheduler is a no-op.
 */
const scheduleSelfPing = () => {
  const pingUrl = process.env.SELF_PING_URL;
  if (!pingUrl) {
    logger.info("Self-ping disabled (SELF_PING_URL not set)");
    return;
  }

  const ping = () => {
    const client = pingUrl.startsWith("https") ? https : http;
    const req = client.get(pingUrl, (res) => {
      logger.info(`Self-ping → ${pingUrl} [${res.statusCode}]`);
      res.resume(); // drain the response body
    });
    req.on("error", (err) => logger.warn(`Self-ping failed: ${err.message}`));
    req.setTimeout(10_000, () => {
      req.destroy();
      logger.warn("Self-ping timed out");
    });
  };

  // Run every 10 minutes
  cron.schedule("*/10 * * * *", ping);
  logger.info(`Self-ping scheduled every 10 minutes → ${pingUrl}`);
};

module.exports = { scheduleSelfPing };
