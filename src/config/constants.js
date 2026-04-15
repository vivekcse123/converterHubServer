"use strict";

const path = require("path");
const fse = require("fs-extra");

const UPLOAD_DIR = path.join(
  __dirname,
  "..",
  "..",
  process.env.UPLOAD_DIR || "uploads",
);
const OUTPUT_DIR = path.join(
  __dirname,
  "..",
  "..",
  process.env.OUTPUT_DIR || "outputs",
);

// 50 MB
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 52_428_800;

// Hours before temp files are deleted
const FILE_EXPIRY_HOURS = parseInt(process.env.FILE_EXPIRY_HOURS, 10) || 2;

const ALLOWED_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  // PDFs
  "application/pdf",
  // Word documents
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Plain text
  "text/plain",
  // ZIP
  "application/zip",
  "application/x-zip-compressed",
];

const ALLOWED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".zip",
];

const PAGE_SIZES = {
  A4: [595.28, 841.89],
  LETTER: [612, 792],
  LEGAL: [612, 1008],
  A3: [841.89, 1190.55],
};

/**
 * Create the upload, output, and logs directories if they don't exist.
 */
const ensureDirectories = async () => {
  await fse.ensureDir(UPLOAD_DIR);
  await fse.ensureDir(OUTPUT_DIR);
  await fse.ensureDir("logs");
};

module.exports = {
  UPLOAD_DIR,
  OUTPUT_DIR,
  MAX_FILE_SIZE,
  FILE_EXPIRY_HOURS,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  PAGE_SIZES,
  ensureDirectories,
};
