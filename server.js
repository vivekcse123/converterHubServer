"use strict";

require("dotenv").config();

const app = require("./src/app");
const { connectDB } = require("./src/config/db");
const logger = require("./src/utils/logger");
const { scheduleFileCleanup } = require("./src/utils/fileCleanup");
const { ensureDirectories } = require("./src/config/constants");

const PORT = process.env.PORT || 5000;

// 🔥 Catch ALL unexpected errors (VERY IMPORTANT)
process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 UNHANDLED REJECTION:", reason);
  // ❌ DO NOT exit immediately during debugging
});

const startServer = async () => {
  try {
    console.log("🚀 Starting server...");

    // Ensure upload / output directories exist
    await ensureDirectories();
    console.log("✅ Directories ready");

    // Connect to MongoDB
    await connectDB();
    console.log("✅ MongoDB connected");

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Converter Hub API → http://localhost:${PORT}`);
      logger.info(
        `📡 Environment: ${process.env.NODE_ENV || "development"}`
      );
    });

    // 🧪 Wrap cleanup in try-catch (common crash source)
    try {
      scheduleFileCleanup();
      console.log("🧹 File cleanup scheduler started");
    } catch (err) {
      console.error("⚠️ File cleanup failed:", err);
    }

    // ─── Graceful Shutdown ─────────────────────────
    const shutdown = (signal) => {
      logger.info(`${signal} received — shutting down gracefully…`);

      server.close(() => {
        logger.info("HTTP server closed");
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error("Forcing shutdown...");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    console.error("💥 Failed to start server:", err);
    process.exit(1);
  }
};

startServer();