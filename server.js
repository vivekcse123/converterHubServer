"use strict";
require("dotenv").config();

const http = require("http");
const app = require("./src/app");
const { connectDB } = require("./src/config/db");
const logger = require("./src/utils/logger");
const { scheduleFileCleanup } = require("./src/utils/fileCleanup");
const { ensureDirectories } = require("./src/config/constants");
const { initSocket } = require("./sockets/index");
const { initQueue } = require("./src/services/queue.service");
const { scheduleSelfPing } = require("./src/utils/selfPing");

const PORT = process.env.PORT || 3000;

process.on("uncaughtException", (err) =>
  logger.error("UNCAUGHT EXCEPTION:", err),
);
process.on("unhandledRejection", (reason) =>
  logger.error("UNHANDLED REJECTION:", reason),
);

const startServer = async () => {
  try {
    await ensureDirectories();
    await connectDB();

    // Create HTTP server (needed for Socket.io to share the port)
    const httpServer = http.createServer(app);

    // Initialize WebSocket
    initSocket(httpServer);

    // Initialize queue (non-blocking — falls back to sync if Redis unavailable)
    await initQueue().catch((err) =>
      logger.warn("Queue init skipped:", err.message),
    );

    // Schedule file cleanup
    try {
      scheduleFileCleanup();
    } catch (err) {
      logger.warn("Cleanup scheduler failed:", err.message);
    }

    // Schedule self-ping keep-alive
    try {
      scheduleSelfPing();
    } catch (err) {
      logger.warn("Self-ping scheduler failed:", err.message);
    }

    httpServer.listen(PORT, () => {
      logger.info(`Converter Hub API v2.0 → http://localhost:${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
    });

    const shutdown = (signal) => {
      logger.info(`${signal} → graceful shutdown`);
      httpServer.close(() => {
        logger.info("HTTP server closed");
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    console.error("=== SERVER STARTUP FAILED ===");
    console.error("Message:", err.message);
    console.error("Stack:", err.stack);
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
