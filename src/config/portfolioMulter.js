"use strict";

const multer = require("multer");

const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8 MB

// Memory storage — the file buffer is piped straight through sharp in the
// controller and never written to disk in its original form, only the
// resized/re-encoded output is persisted.
const uploadPortfolioImage = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported image type: ${file.mimetype}`), false);
  },
  limits: { fileSize: MAX_IMAGE_SIZE },
}).single("image");

const handlePortfolioImageUpload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadPortfolioImage(req, res, (err) => (err ? reject(err) : resolve()));
  });

module.exports = { handlePortfolioImageUpload };
