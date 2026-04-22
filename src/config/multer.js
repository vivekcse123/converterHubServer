"use strict";

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  UPLOAD_DIR,
} = require("./constants");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${uuidv4()}${ext}`;
    cb(null, safeName);
  },
});

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
  }
};

/** Single-file upload */
const uploadSingle = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
}).single("file");

/** Multi-file upload (max 20 files) */
const uploadMultiple = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 20 },
}).array("files", 20);

/** Fields upload for sign-pdf (main PDF + optional signature image) */
const uploadSignFields = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 2 },
}).fields([
  { name: "file", maxCount: 1 },
  { name: "signatureImage", maxCount: 1 },
]);

/** Promisified wrappers so controllers can use async/await */
const handleSingleUpload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadSingle(req, res, (err) => (err ? reject(err) : resolve()));
  });

const handleMultipleUpload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadMultiple(req, res, (err) => (err ? reject(err) : resolve()));
  });

const handleSignUpload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadSignFields(req, res, (err) => (err ? reject(err) : resolve()));
  });

module.exports = { handleSingleUpload, handleMultipleUpload, handleSignUpload };
