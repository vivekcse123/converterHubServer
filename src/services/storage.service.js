"use strict";
const fse = require("fs-extra");
const path = require("path");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { OUTPUT_DIR } = require("../config/constants");
const logger = require("../utils/logger");

// Detect storage mode: "s3" | "local"
const USE_S3 =
  process.env.STORAGE_MODE === "s3" && !!process.env.AWS_BUCKET_NAME;

let s3 = null;
if (USE_S3) {
  s3 = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

const BUCKET = process.env.AWS_BUCKET_NAME;
const PRESIGNED_EXPIRES =
  parseInt(process.env.S3_PRESIGNED_EXPIRES, 10) || 3600; // 1 hour default

// ── Local storage helpers ────────────────────────────────────────────────────
const localUrl = (req, fileName) =>
  `${req?.protocol || "http"}://${req?.get?.("host") || "localhost:5000"}/outputs/${fileName}`;

// ── S3 helpers ───────────────────────────────────────────────────────────────
const uploadToS3 = async (filePath, s3Key) => {
  const body = await fse.readFile(filePath);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: body,
      ContentDisposition: `attachment; filename="${path.basename(s3Key)}"`,
    }),
  );
  return `https://${BUCKET}.s3.amazonaws.com/${s3Key}`;
};

const getS3SignedUrl = async (s3Key) => {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
  return getSignedUrl(s3, cmd, { expiresIn: PRESIGNED_EXPIRES });
};

const deleteFromS3 = async (s3Key) => {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  } catch (err) {
    logger.warn(`S3 delete failed for ${s3Key}:`, err.message);
  }
};

// ── Public API ───────────────────────────────────────────────────────────────
/**
 * Store a file (local or S3) and return the public URL.
 * @param {string} filePath  - Local path of the already-written output file
 * @param {string} fileName  - Desired file name
 * @param {object} req       - Express request (for constructing local URL)
 */
const storeFile = async (filePath, fileName, req = null) => {
  if (!USE_S3) {
    return { url: localUrl(req, fileName), storageKey: null, isS3: false };
  }
  const s3Key = `outputs/${fileName}`;
  const url = await uploadToS3(filePath, s3Key);
  // Delete local file after S3 upload to save disk space
  await fse.remove(filePath).catch(() => {});
  return { url, storageKey: s3Key, isS3: true };
};

/**
 * Generate a download URL for an already-stored file.
 */
const getDownloadUrl = async (fileName, storageKey, req = null) => {
  if (!USE_S3 || !storageKey) return localUrl(req, fileName);
  return getS3SignedUrl(storageKey);
};

/**
 * Delete a file from storage.
 */
const deleteFile = async (filePath, storageKey = null) => {
  if (USE_S3 && storageKey) await deleteFromS3(storageKey);
  try {
    await fse.remove(filePath);
  } catch {
    /* ignore */
  }
};

module.exports = { storeFile, getDownloadUrl, deleteFile, localUrl, USE_S3 };
