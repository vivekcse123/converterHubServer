"use strict";

const multer = require("multer");
const path = require("path");
const fse = require("fs-extra");
const fsp = require("fs/promises");
const { v4: uuidv4 } = require("uuid");
const {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  UPLOAD_DIR,
} = require("./constants");

// Ensure upload directory exists (async — doesn't block the event loop).
fse.ensureDir(UPLOAD_DIR).catch(() => {});

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

// ── Content-based verification ────────────────────────────────────────────────
// `fileFilter` above only checks the browser-supplied Content-Type header,
// which any client can set to anything regardless of the file's real bytes.
// This verifies the file actually IS what it claims to be once multer has
// written it to disk, closing that gap for formats with an identifiable
// signature. Plain-text formats (text/plain, csv, markdown, json) have no
// fixed byte signature, so there's nothing meaningful to check — they're
// left to the MIME/extension check alone.
const MAGIC_BYTES = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/jpg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/gif": [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  "image/bmp": [[0x42, 0x4d]],
  "image/tiff": [[0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a]],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "application/zip": [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]],
  "application/x-zip-compressed": [[0x50, 0x4b, 0x03, 0x04]],
  "application/epub+zip": [[0x50, 0x4b, 0x03, 0x04]],
  // Modern Office formats (.docx/.xlsx/.pptx) are ZIP containers.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [[0x50, 0x4b, 0x03, 0x04]],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [[0x50, 0x4b, 0x03, 0x04]],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [[0x50, 0x4b, 0x03, 0x04]],
  // Legacy Office formats (.doc/.xls/.ppt) use the OLE/CFB container.
  "application/msword": [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  "application/vnd.ms-excel": [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  "application/vnd.ms-powerpoint": [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
};

// XML/text-structured formats verified by sniffing readable content instead
// of a fixed byte signature (SVG in particular was flagged: it's plain XML
// text, so nothing stopped an arbitrary file from being uploaded as long as
// the client claimed `image/svg+xml`).
const TEXT_SNIFFS = {
  "image/svg+xml": (text) => /<\?xml|<svg[\s>]/i.test(text),
  "text/html": (text) => /<!doctype html|<html[\s>]/i.test(text),
  "application/xml": (text) => /<\?xml|^\s*</.test(text),
  "text/xml": (text) => /<\?xml|^\s*</.test(text),
};

const readPrefix = async (filePath, length) => {
  const fh = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
};

const matchesSignature = (buf, sig) => sig.every((byte, i) => buf[i] === byte);

const rejectMismatch = async (filePath, mimetype) => {
  await fse.remove(filePath).catch(() => {});
  throw new Error(`File content doesn't match the declared type (${mimetype}).`);
};

const verifyFileSignature = async (filePath, mimetype) => {
  const textSniff = TEXT_SNIFFS[mimetype];
  if (textSniff) {
    const buf = await readPrefix(filePath, 512);
    if (!textSniff(buf.toString("utf8"))) await rejectMismatch(filePath, mimetype);
    return;
  }

  if (mimetype === "image/webp") {
    const buf = await readPrefix(filePath, 12);
    const ok = matchesSignature(buf, [0x52, 0x49, 0x46, 0x46]) && buf.subarray(8, 12).toString("ascii") === "WEBP";
    if (!ok) await rejectMismatch(filePath, mimetype);
    return;
  }
  if (mimetype === "image/heic" || mimetype === "image/heif") {
    // ISO-BMFF: a 4-byte box size, then "ftyp" at bytes 4-7.
    const buf = await readPrefix(filePath, 8);
    if (buf.subarray(4, 8).toString("ascii") !== "ftyp") await rejectMismatch(filePath, mimetype);
    return;
  }

  const signatures = MAGIC_BYTES[mimetype];
  if (!signatures) return; // no known signature for this type — MIME/extension check only

  const buf = await readPrefix(filePath, 16);
  if (!signatures.some((sig) => matchesSignature(buf, sig))) await rejectMismatch(filePath, mimetype);
};

/** Runs verifyFileSignature over every file multer attached to the request
 *  (req.file, req.files as an array, or req.files as named fields), deleting
 *  and rejecting on the first mismatch. */
const verifyUploadedFiles = async (req) => {
  const files = req.file
    ? [req.file]
    : Array.isArray(req.files)
      ? req.files
      : req.files
        ? Object.values(req.files).flat()
        : [];
  for (const file of files) {
    await verifyFileSignature(file.path, file.mimetype);
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

/** Promisified wrappers so controllers can use async/await. Each verifies the
 *  uploaded file(s)' actual bytes match their claimed MIME type before
 *  resolving, on top of multer's own Content-Type-based fileFilter. */
const handleSingleUpload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadSingle(req, res, (err) => {
      if (err) return reject(err);
      verifyUploadedFiles(req).then(resolve, reject);
    });
  });

const handleMultipleUpload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadMultiple(req, res, (err) => {
      if (err) return reject(err);
      verifyUploadedFiles(req).then(resolve, reject);
    });
  });

const handleSignUpload = (req, res) =>
  new Promise((resolve, reject) => {
    uploadSignFields(req, res, (err) => {
      if (err) return reject(err);
      verifyUploadedFiles(req).then(resolve, reject);
    });
  });

module.exports = { handleSingleUpload, handleMultipleUpload, handleSignUpload };
