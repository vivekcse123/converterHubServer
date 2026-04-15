"use strict";

const path = require("path");
const fse = require("fs-extra");
const { v4: uuidv4 } = require("uuid");

const {
  handleSingleUpload,
  handleMultipleUpload,
} = require("../config/multer");
const imageService = require("../services/image.service");
const pdfService = require("../services/pdf.service");
const compressionService = require("../services/compression.service");
const ConversionHistory = require("../models/ConversionHistory");
const { deleteFile } = require("../utils/fileCleanup");
const { success, error } = require("../utils/response");
const logger = require("../utils/logger");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Record a conversion event in the database. */
const logConversion = async (
  req,
  tool,
  inputFiles,
  outputFile,
  status,
  errorMessage,
  startMs,
) => {
  try {
    await ConversionHistory.create({
      user: req.user?._id,
      sessionId: req.headers["x-session-id"],
      tool,
      status,
      inputFiles: inputFiles.map((f) => ({
        originalName: f.originalname,
        size: f.size,
        mimeType: f.mimetype,
      })),
      outputFile,
      errorMessage,
      processingTimeMs: Date.now() - startMs,
      ipAddress: req.ip,
    });
  } catch (e) {
    logger.warn("History log failed:", e.message);
  }
};

/** Build a public download URL for an output file. */
const buildDownloadUrl = (req, fileName) =>
  `${req.protocol}://${req.get("host")}/outputs/${fileName}`;

/** Clean up input file after processing. */
const cleanup = (filePath) => deleteFile(filePath);

// ─── Controllers ──────────────────────────────────────────────────────────────

// POST /api/convert/image-to-pdf
const imageToPdf = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleMultipleUpload(req, res);

    if (!req.files?.length) {
      return error(res, "No image files uploaded", 400);
    }

    const { pageSize = "A4", orientation = "portrait", margin = 20 } = req.body;
    const imagePaths = req.files.map((f) => f.path);

    const { outputPath, fileName } = await pdfService.imagesToPdf(imagePaths, {
      pageSize,
      orientation,
      margin: parseInt(margin),
    });

    const stat = await fse.stat(outputPath);
    const result = {
      fileName,
      downloadUrl: buildDownloadUrl(req, fileName),
      size: stat.size,
    };

    await logConversion(
      req,
      "image-to-pdf",
      req.files,
      result,
      "completed",
      null,
      startMs,
    );
    imagePaths.forEach(cleanup);

    success(res, result, "Images converted to PDF successfully");
  } catch (err) {
    if (req.files) req.files.forEach((f) => cleanup(f.path));
    await logConversion(
      req,
      "image-to-pdf",
      req.files || [],
      null,
      "failed",
      err.message,
      startMs,
    );
    next(err);
  }
};

// POST /api/convert/pdf-to-word
const pdfToWord = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF file uploaded", 400);

    const { outputPath, fileName } = await pdfService.pdfToWord(req.file.path);
    const stat = await fse.stat(outputPath);
    const result = {
      fileName,
      downloadUrl: buildDownloadUrl(req, fileName),
      size: stat.size,
    };

    await logConversion(
      req,
      "pdf-to-word",
      [req.file],
      result,
      "completed",
      null,
      startMs,
    );
    cleanup(req.file.path);
    success(res, result, "PDF converted to Word successfully");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

// POST /api/convert/word-to-pdf
const wordToPdf = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No Word file uploaded", 400);

    const { outputPath, fileName } = await pdfService.wordToPdf(req.file.path);
    const stat = await fse.stat(outputPath);
    const result = {
      fileName,
      downloadUrl: buildDownloadUrl(req, fileName),
      size: stat.size,
    };

    await logConversion(
      req,
      "word-to-pdf",
      [req.file],
      result,
      "completed",
      null,
      startMs,
    );
    cleanup(req.file.path);
    success(res, result, "Word document converted to PDF successfully");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

// POST /api/convert/pdf-merge
const pdfMerge = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleMultipleUpload(req, res);
    if (!req.files || req.files.length < 2) {
      return error(res, "Please upload at least 2 PDF files to merge", 400);
    }

    const pdfPaths = req.files.map((f) => f.path);
    const { outputPath, fileName } = await pdfService.mergePdfs(pdfPaths);
    const stat = await fse.stat(outputPath);
    const result = {
      fileName,
      downloadUrl: buildDownloadUrl(req, fileName),
      size: stat.size,
    };

    await logConversion(
      req,
      "pdf-merge",
      req.files,
      result,
      "completed",
      null,
      startMs,
    );
    pdfPaths.forEach(cleanup);
    success(res, result, `${req.files.length} PDFs merged successfully`);
  } catch (err) {
    if (req.files) req.files.forEach((f) => cleanup(f.path));
    next(err);
  }
};

// POST /api/convert/pdf-split
const pdfSplit = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);

    const pageFiles = await pdfService.splitPdf(req.file.path);
    const zipResult = await compressionService.zipPdfPages(pageFiles);

    const result = {
      fileName: zipResult.fileName,
      downloadUrl: buildDownloadUrl(req, zipResult.fileName),
      size: zipResult.size,
      pageCount: pageFiles.length,
    };

    cleanup(req.file.path);
    pageFiles.forEach((f) => cleanup(f.filePath));
    success(res, result, `PDF split into ${pageFiles.length} pages`);
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

// POST /api/convert/pdf-compress
const pdfCompress = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);

    const result = await pdfService.compressPdf(req.file.path);
    cleanup(req.file.path);
    success(
      res,
      { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) },
      "PDF compressed",
    );
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

// POST /api/convert/image-resize
const imageResize = async (req, res, next) => {
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No image uploaded", 400);

    const { width, height, fit } = req.body;
    const result = await imageService.resizeImage(req.file.path, {
      width,
      height,
      fit,
    });
    cleanup(req.file.path);
    success(
      res,
      { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) },
      "Image resized",
    );
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

// POST /api/convert/image-compress
const imageCompress = async (req, res, next) => {
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No image uploaded", 400);

    const { quality = 75, format } = req.body;
    const result = await imageService.compressImage(req.file.path, {
      quality,
      format,
    });
    cleanup(req.file.path);
    success(
      res,
      { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) },
      "Image compressed",
    );
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

// POST /api/convert/image-convert
const imageConvert = async (req, res, next) => {
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No image uploaded", 400);

    const { format = "jpeg" } = req.body;
    const result = await imageService.convertImageFormat(req.file.path, format);
    cleanup(req.file.path);
    success(
      res,
      { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) },
      "Image converted",
    );
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

// POST /api/convert/text-to-pdf
const textToPdf = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return error(res, "text field is required", 400);

    const result = await pdfService.textToPdf(text);
    success(
      res,
      { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) },
      "Text converted to PDF",
    );
  } catch (err) {
    next(err);
  }
};

// POST /api/convert/create-zip
const createZip = async (req, res, next) => {
  try {
    await handleMultipleUpload(req, res);
    if (!req.files?.length) return error(res, "No files uploaded", 400);

    const files = req.files.map((f) => ({
      filePath: f.path,
      archiveName: f.originalname,
    }));
    const result = await compressionService.createZip(files);
    req.files.forEach((f) => cleanup(f.path));
    success(
      res,
      { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) },
      "ZIP created",
    );
  } catch (err) {
    if (req.files) req.files.forEach((f) => cleanup(f.path));
    next(err);
  }
};

module.exports = {
  imageToPdf,
  pdfToWord,
  wordToPdf,
  pdfMerge,
  pdfSplit,
  pdfCompress,
  imageResize,
  imageCompress,
  imageConvert,
  textToPdf,
  createZip,
};
