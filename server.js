"use strict";

require("dotenv").config();

const app = require("./src/app");
const { connectDB } = require("./src/config/db");
const logger = require("./src/utils/logger");
const { scheduleFileCleanup } = require("./src/utils/fileCleanup");
const { ensureDirectories } = require("./src/config/constants");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Ensure upload / output directories exist before anything runs
    await ensureDirectories();

    // Connect to MongoDB
    await connectDB();

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`🚀  Converter Hub API  →  http://localhost:${PORT}`);
      logger.info(`📡  Environment: ${process.env.NODE_ENV || "development"}`);
    });

    // Schedule periodic cleanup of expired temp files
    scheduleFileCleanup();

    // ─── Graceful Shutdown ─────────────────────────
    const shutdown = (signal) => {
      logger.info(`${signal} received — shutting down gracefully…`);
      server.close(() => {
        logger.info("HTTP server closed");
        process.exit(0);
      });
      // Force exit after 10 s if server hasn't closed
      setTimeout(() => process.exit(1), 10_000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled Rejection:", reason);
      process.exit(1);
    });
  } catch (err) {
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
