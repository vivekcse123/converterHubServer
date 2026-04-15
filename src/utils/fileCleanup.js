"use strict";

const cron = require("node-cron");
const fse = require("fs-extra");
const path = require("path");
const logger = require("./logger");
const {
  UPLOAD_DIR,
  OUTPUT_DIR,
  FILE_EXPIRY_HOURS,
} = require("../config/constants");

/**
 * Delete files older than FILE_EXPIRY_HOURS from a directory.
 */
const cleanDirectory = async (dir) => {
  const now = Date.now();
  const maxAge = FILE_EXPIRY_HOURS * 60 * 60 * 1000;

  try {
    const entries = await fse.readdir(dir);
    let deleted = 0;

    for (const entry of entries) {
      if (entry === ".gitkeep") continue;

      const filePath = path.join(dir, entry);
      try {
        const stat = await fse.stat(filePath);
        if (now - stat.mtimeMs > maxAge) {
          await fse.remove(filePath);
          deleted++;
        }
      } catch {
        // File may have been removed concurrently — ignore
      }
    }

    if (deleted > 0) {
      logger.info(
        `File cleanup: removed ${deleted} expired file(s) from ${dir}`,
      );
    }
  } catch (err) {
    logger.error(`File cleanup error in ${dir}:`, err.message);
  }
};

/**
 * Run cleanup immediately, then every hour via cron.
 */
const scheduleFileCleanup = () => {
  // Run once on startup
  cleanDirectory(UPLOAD_DIR);
  cleanDirectory(OUTPUT_DIR);

  // Run every hour
  cron.schedule("0 * * * *", () => {
    logger.info("Running scheduled file cleanup…");
    cleanDirectory(UPLOAD_DIR);
    cleanDirectory(OUTPUT_DIR);
  });
};

/**
 * Delete a specific file silently (used after processing).
 */
const deleteFile = async (filePath) => {
  try {
    await fse.remove(filePath);
  } catch {
    // non-fatal
  }
};

module.exports = { scheduleFileCleanup, cleanDirectory, deleteFile };
