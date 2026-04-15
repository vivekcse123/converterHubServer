"use strict";

const sharp = require("sharp");
const path = require("path");
const fse = require("fs-extra");
const { v4: uuidv4 } = require("uuid");
const { OUTPUT_DIR } = require("../config/constants");

/**
 * Resize an image.
 * @param {string} inputPath
 * @param {{ width?: number, height?: number, fit?: string }} options
 * @returns {Promise<{ outputPath: string, fileName: string }>}
 */
const resizeImage = async (
  inputPath,
  { width, height, fit = "inside" } = {},
) => {
  const fileName = `resized-${uuidv4()}.jpg`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  await sharp(inputPath)
    .resize(width ? parseInt(width) : null, height ? parseInt(height) : null, {
      fit,
    })
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  return { outputPath, fileName };
};

/**
 * Compress an image (reduce quality / file size).
 * @param {string} inputPath
 * @param {{ quality?: number, format?: string }} options
 * @returns {Promise<{ outputPath: string, fileName: string, originalSize: number, newSize: number }>}
 */
const compressImage = async (
  inputPath,
  { quality = 75, format = "jpeg" } = {},
) => {
  const ext = format === "png" ? ".png" : ".jpg";
  const fileName = `compressed-${uuidv4()}${ext}`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  const instance = sharp(inputPath);
  if (format === "png") {
    instance.png({ quality: parseInt(quality), compressionLevel: 9 });
  } else {
    instance.jpeg({ quality: parseInt(quality), mozjpeg: true });
  }
  await instance.toFile(outputPath);

  const [originalStat, newStat] = await Promise.all([
    fse.stat(inputPath),
    fse.stat(outputPath),
  ]);

  return {
    outputPath,
    fileName,
    originalSize: originalStat.size,
    newSize: newStat.size,
  };
};

/**
 * Convert image format (e.g. PNG → JPG, JPG → WEBP).
 * @param {string} inputPath
 * @param {'jpeg'|'png'|'webp'|'bmp'} targetFormat
 */
const convertImageFormat = async (inputPath, targetFormat = "jpeg") => {
  const extMap = { jpeg: ".jpg", png: ".png", webp: ".webp", bmp: ".bmp" };
  const ext = extMap[targetFormat] || ".jpg";
  const fileName = `converted-${uuidv4()}${ext}`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  await sharp(inputPath)[targetFormat]({ quality: 90 }).toFile(outputPath);
  return { outputPath, fileName };
};

/**
 * Crop an image.
 */
const cropImage = async (inputPath, { left, top, width, height }) => {
  const fileName = `cropped-${uuidv4()}.jpg`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  await sharp(inputPath)
    .extract({
      left: parseInt(left),
      top: parseInt(top),
      width: parseInt(width),
      height: parseInt(height),
    })
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  return { outputPath, fileName };
};

/**
 * Get image metadata.
 */
const getImageMetadata = async (inputPath) => {
  const meta = await sharp(inputPath).metadata();
  return {
    width: meta.width,
    height: meta.height,
    format: meta.format,
    channels: meta.channels,
    size: meta.size,
  };
};

module.exports = {
  resizeImage,
  compressImage,
  convertImageFormat,
  cropImage,
  getImageMetadata,
};
