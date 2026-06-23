"use strict";

const mongoose = require("mongoose");
const logger = require("../utils/logger");

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not defined in environment variables");
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 30_000,  // 5 s was too short for cold Render → Atlas handshake
      socketTimeoutMS: 45_000,
      connectTimeoutMS: 30_000,
      maxPoolSize: 10,
      minPoolSize: 2,              // keep 2 warm connections so post-wake queries don't wait for pool growth
      maxIdleTimeMS: 120_000,      // hold idle connections for 2 min (was 1 min) to survive brief lulls
      heartbeatFrequencyMS: 10_000, // check Atlas every 10 s — detects stale connections fast
      family: 4,                   // force IPv4 — avoids Alpine musl IPv6 SRV lookup issues
    });
    logger.info(`MongoDB connected: ${mongoose.connection.host}`);
  } catch (err) {
    logger.error("MongoDB connection failed:", err.message);
    throw err;
  }
};

mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
  logger.error("MongoDB error:", err.message);
});

module.exports = { connectDB };
