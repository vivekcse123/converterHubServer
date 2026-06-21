"use strict";

const logger = require("../utils/logger");

/**
 * Map low-level error messages to user-friendly ones.
 * Returns { statusCode, message } or null to let default handling proceed.
 */
const classifyError = (err) => {
  const msg = (err.message || "").toLowerCase();
  const code = err.code || "";

  // File type not supported
  if (msg.includes("unsupported file type") || msg.includes("mimetype") || err.status === 415) {
    return { statusCode: 415, message: err.message || "This file type is not supported. Please check the accepted formats." };
  }

  // File size
  if (code === "LIMIT_FILE_SIZE" || msg.includes("too large") || msg.includes("file size")) {
    const mb = Math.round((parseInt(process.env.MAX_FILE_SIZE, 10) || 52_428_800) / 1_048_576);
    return { statusCode: 413, message: `Your file exceeds the ${mb} MB size limit. Please use a smaller file.` };
  }

  // Too many files
  if (code === "LIMIT_FILE_COUNT") {
    return { statusCode: 400, message: "Too many files uploaded at once." };
  }

  // Password-protected PDF
  if (msg.includes("password") || msg.includes("encrypted") || msg.includes("security handler")) {
    return { statusCode: 400, message: "This PDF is password-protected. Please unlock it first using the Unlock PDF tool, then retry." };
  }

  // Corrupted or invalid file
  if (
    msg.includes("bad xref") ||
    msg.includes("invalid pdf") ||
    msg.includes("malformed") ||
    msg.includes("corrupt") ||
    msg.includes("unexpected end")
  ) {
    return { statusCode: 400, message: "The file appears to be corrupted or invalid. Please try a different file." };
  }

  // Empty / no pages
  if (msg.includes("no pages") || msg.includes("empty pdf") || msg.includes("0 pages")) {
    return { statusCode: 400, message: "The PDF file appears to be empty (0 pages). Please check the file and try again." };
  }

  // OCR-specific
  if (msg.includes("tesseract") || msg.includes("ocr")) {
    return { statusCode: 500, message: "OCR processing failed. Please ensure the file is a clear scan and try again." };
  }

  // Conversion produced no output
  if (msg.includes("produced no output") || msg.includes("empty output")) {
    return { statusCode: 500, message: err.message };
  }

  // Timeout
  if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("timed out")) {
    return { statusCode: 408, message: "The conversion timed out. Your file may be too large or complex — please try a smaller file." };
  }

  // Disk space
  if (msg.includes("enospc") || msg.includes("no space left") || msg.includes("disk")) {
    return { statusCode: 507, message: "Server storage is temporarily full. Please try again in a few minutes." };
  }

  // Output file missing (post-conversion)
  if (msg.includes("enoent") || msg.includes("no such file or directory")) {
    return { statusCode: 500, message: "The converted file could not be retrieved. Please try again." };
  }

  // Network / connection errors
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET") {
    return { statusCode: 503, message: "A connection error occurred. Please check your network and try again." };
  }

  // LibreOffice / external binary errors
  if (msg.includes("libreoffice") || msg.includes("soffice")) {
    return { statusCode: 500, message: "Document conversion failed. Please ensure the file is a valid Word document and try again." };
  }

  // Ghostscript errors
  if (msg.includes("ghostscript") || msg.includes("gs:")) {
    return { statusCode: 500, message: "PDF processing failed. Please check the file is a valid PDF and try again." };
  }

  return null; // Let default handling proceed
};

/**
 * Centralized error handler — must come after all routes.
 */
const errorHandler = (err, req, res, _next) => {
  logger.error(`${req.method} ${req.path} → ${err.message}`, {
    stack: err.stack,
    code: err.code,
  });

  // Try to classify into a user-friendly message first
  const classified = classifyError(err);
  if (classified) {
    return res.status(classified.statusCode).json({
      success: false,
      message: classified.message,
    });
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
    const field = Object.keys(err.keyValue || {})[0] || "field";
    return res.status(409).json({
      success: false,
      message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists.`,
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  res.status(statusCode).json({
    success: false,
    message:
      isClientError || process.env.NODE_ENV !== "production"
        ? err.message || "An error occurred"
        : "An unexpected error occurred. Please try again.",
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

module.exports = { errorHandler, notFoundHandler, classifyError };
