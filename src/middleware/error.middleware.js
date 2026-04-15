"use strict";

const logger = require("../utils/logger");

/**
 * Centralized error handler — must come after all routes.
 */
const errorHandler = (err, req, res, _next) => {
  logger.error(`${req.method} ${req.path} → ${err.message}`, {
    stack: err.stack,
  });

  // Multer errors
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: `File too large. Maximum allowed size is ${Math.round(
        (process.env.MAX_FILE_SIZE || 52_428_800) / 1_048_576,
      )} MB.`,
    });
  }

  if (err.code === "LIMIT_FILE_COUNT") {
    return res
      .status(400)
      .json({ success: false, message: "Too many files uploaded." });
  }

  if (err.message && err.message.startsWith("Unsupported file type")) {
    return res.status(415).json({ success: false, message: err.message });
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res
      .status(400)
      .json({ success: false, message: messages.join(", ") });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({
      success: false,
      message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists.`,
    });
  }

  // Default 500
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
};

/**
 * 404 handler — call after all routes are defined.
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.path}`,
  });
};

module.exports = { errorHandler, notFoundHandler };
