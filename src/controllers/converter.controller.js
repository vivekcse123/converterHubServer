"use strict";
const path = require("path");
const fse = require("fs-extra");
const { v4: uuidv4 } = require("uuid");

const {
  handleSingleUpload,
  handleMultipleUpload,
  handleSignUpload,
} = require("../config/multer");
const imageService = require("../services/image.service");
const pdfService = require("../services/pdf.service");
const compressionService = require("../services/compression.service");
const advancedPdf = require("../services/advanced-pdf.service");
const extConverters = require("../services/extended-converters.service");
const ocrService = require("../services/ocr.service");
const storageService = require("../services/storage.service");
const ConversionHistory = require("../models/ConversionHistory");
const User = require("../models/User");
const { deleteFile } = require("../utils/fileCleanup");
const { success, error } = require("../utils/response");
const { SUBSCRIPTION_PLANS } = require("../config/constants");
const logger = require("../utils/logger");

// ── Helpers ──────────────────────────────────────────────────────────────────
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
      inputFiles: (inputFiles || []).map((f) => ({
        originalName: f.originalname || f.originalName,
        size: f.size,
        mimeType: f.mimetype || f.mimeType,
      })),
      outputFile,
      errorMessage,
      processingTimeMs: Date.now() - startMs,
      ipAddress: req.ip,
    });
    // Increment usage counter
    if (req.user?._id) {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { "usage.conversionsToday": 1, "usage.totalConversions": 1 },
      });
    }
  } catch (e) {
    logger.warn("History log failed:", e.message);
  }
};

const buildDownloadUrl = (req, fileName) => {
  const base = process.env.BACKEND_URL ||
    `${req.headers["x-forwarded-proto"] || req.protocol}://${req.headers["x-forwarded-host"] || req.get("host")}`;
  return `${base}/outputs/${fileName}`;
};

const cleanup = (filePath) => deleteFile(filePath);

const withSingle = (fn, tool) => async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No file uploaded", 400);
    const result = await fn(req.file.path, req.body);
    const stat = await fse.stat(result.outputPath).catch(() => ({ size: 0 }));
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size || stat.size,
      ...result,
    };
    delete out.outputPath;
    await logConversion(req, tool, [req.file], out, "completed", null, startMs);
    cleanup(req.file.path);
    success(res, out, "Conversion successful");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    await logConversion(
      req,
      tool,
      req.file ? [req.file] : [],
      null,
      "failed",
      err.message,
      startMs,
    );
    next(err);
  }
};

const withMultiple = (fn, tool) => async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleMultipleUpload(req, res);
    if (!req.files?.length) return error(res, "No files uploaded", 400);
    const result = await fn(
      req.files.map((f) => f.path),
      req.body,
      req.files,
    );
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size,
      ...result,
    };
    delete out.outputPath;
    await logConversion(req, tool, req.files, out, "completed", null, startMs);
    req.files.forEach((f) => cleanup(f.path));
    success(res, out, "Conversion successful");
  } catch (err) {
    if (req.files) req.files.forEach((f) => cleanup(f.path));
    next(err);
  }
};

// ── Original Controllers ──────────────────────────────────────────────────────
const imageToPdf = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleMultipleUpload(req, res);
    if (!req.files?.length) return error(res, "No image files uploaded", 400);
    const { pageSize = "A4", orientation = "portrait", margin = 20 } = req.body;
    const imagePaths = req.files.map((f) => f.path);
    const result = await pdfService.imagesToPdf(imagePaths, {
      pageSize,
      orientation,
      margin: parseInt(margin),
    });
    const stat = await fse.stat(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: stat.size,
    };
    await logConversion(
      req,
      "image-to-pdf",
      req.files,
      out,
      "completed",
      null,
      startMs,
    );
    imagePaths.forEach(cleanup);
    success(res, out, "Images converted to PDF successfully");
  } catch (err) {
    if (req.files) req.files.forEach((f) => cleanup(f.path));
    next(err);
  }
};

const pdfToWord = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF file uploaded", 400);
    const result = await pdfService.pdfToWord(req.file.path);
    const stat = await fse.stat(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: stat.size,
    };
    await logConversion(
      req,
      "pdf-to-word",
      [req.file],
      out,
      "completed",
      null,
      startMs,
    );
    cleanup(req.file.path);
    success(res, out, "PDF converted to Word successfully");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

const wordToPdf = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No Word file uploaded", 400);
    const result = await pdfService.wordToPdf(req.file.path);
    const stat = await fse.stat(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: stat.size,
    };
    await logConversion(
      req,
      "word-to-pdf",
      [req.file],
      out,
      "completed",
      null,
      startMs,
    );
    cleanup(req.file.path);
    success(res, out, "Word document converted to PDF successfully");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

const pdfMerge = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleMultipleUpload(req, res);
    if (!req.files || req.files.length < 2)
      return error(res, "Please upload at least 2 PDF files to merge", 400);
    const pdfPaths = req.files.map((f) => f.path);
    const result = await pdfService.mergePdfs(pdfPaths);
    const stat = await fse.stat(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: stat.size,
    };
    await logConversion(
      req,
      "pdf-merge",
      req.files,
      out,
      "completed",
      null,
      startMs,
    );
    pdfPaths.forEach(cleanup);
    success(res, out, `${req.files.length} PDFs merged successfully`);
  } catch (err) {
    if (req.files) req.files.forEach((f) => cleanup(f.path));
    next(err);
  }
};

const pdfSplit = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);
    const pageFiles = await pdfService.splitPdf(req.file.path);
    const zipResult = await compressionService.zipPdfPages(pageFiles);
    const out = {
      fileName: zipResult.fileName,
      downloadUrl: buildDownloadUrl(req, zipResult.fileName),
      size: zipResult.size,
      pageCount: pageFiles.length,
    };
    cleanup(req.file.path);
    pageFiles.forEach((f) => cleanup(f.filePath));
    success(res, out, `PDF split into ${pageFiles.length} pages`);
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

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

const textToPdf = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return error(res, "text field is required", 400);
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

// ── Advanced PDF Controllers ──────────────────────────────────────────────────

const pdfToJpg = withSingle((p, b) => advancedPdf.pdfToJpg(p, b), "pdf-to-jpg");
const watermarkPdf = withSingle(
  (p, b) => advancedPdf.watermarkPdf(p, b),
  "watermark-pdf",
);
const signPdf = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSignUpload(req, res);
    const pdfFile = req.files?.file?.[0];
    if (!pdfFile) return error(res, "No PDF file uploaded", 400);

    // Read uploaded signature image and convert to base64 for the service
    const sigFile = req.files?.signatureImage?.[0];
    let signatureImage = req.body.signatureImage ?? null;
    if (sigFile && !signatureImage) {
      const imgBuf = await fse.readFile(sigFile.path);
      const mimeType = sigFile.mimetype || "image/png";
      signatureImage = `data:${mimeType};base64,${imgBuf.toString("base64")}`;
    }

    const result = await advancedPdf.signPdf(pdfFile.path, {
      ...req.body,
      signatureImage,
    });

    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size,
    };
    await logConversion(req, "sign-pdf", [pdfFile], out, "completed", null, startMs);
    cleanup(pdfFile.path);
    if (sigFile) cleanup(sigFile.path);
    success(res, out, "PDF signed successfully");
  } catch (err) {
    if (req.files?.file?.[0])           cleanup(req.files.file[0].path);
    if (req.files?.signatureImage?.[0]) cleanup(req.files.signatureImage[0].path);
    await logConversion(req, "sign-pdf", [], null, "failed", err.message, startMs);
    next(err);
  }
};
const redactPdf = withSingle(
  (p, b) =>
    advancedPdf.redactPdf(p, { regions: JSON.parse(b.regions || "[]") }),
  "redact-pdf",
);
const addPageNumbers = withSingle(
  (p, b) => advancedPdf.addPageNumbers(p, b),
  "page-numbers",
);
const pdfToPdfa = withSingle((p) => advancedPdf.pdfToPdfa(p), "pdf-to-pdfa");

const comparePdfs = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleMultipleUpload(req, res);
    if (!req.files || req.files.length < 2)
      return error(res, "Please upload exactly 2 PDF files to compare", 400);
    const result = await advancedPdf.comparePdfs(
      req.files[0].path,
      req.files[1].path,
    );
    req.files.forEach((f) => cleanup(f.path));
    success(
      res,
      { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) },
      "PDF comparison complete",
    );
  } catch (err) {
    if (req.files) req.files.forEach((f) => cleanup(f.path));
    next(err);
  }
};

const performOcr = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No file uploaded", 400);
    const { lang = "eng", outputFormat = "pdf" } = req.body;
    const result = await ocrService.performOCR(req.file.path, {
      lang,
      outputFormat,
    });
    cleanup(req.file.path);
    await logConversion(
      req,
      "ocr",
      [req.file],
      result,
      "completed",
      null,
      startMs,
    );
    success(
      res,
      { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) },
      "OCR complete",
    );
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
  }
};

// ── Extended Converters ───────────────────────────────────────────────────────

const pdfToTxt = withSingle((p) => extConverters.pdfToTxt(p), "pdf-to-txt");
const pdfToMarkdown = withSingle(
  (p) => extConverters.pdfToMarkdown(p),
  "pdf-to-markdown",
);
const pdfToJson = withSingle((p) => extConverters.pdfToJson(p), "pdf-to-json");
const pdfToXml = withSingle((p) => extConverters.pdfToXml(p), "pdf-to-xml");
const pdfToCsv = withSingle((p) => extConverters.pdfToCsv(p), "pdf-to-csv");
const pdfToEpub = withSingle(
  (p, b) => extConverters.pdfToEpub(p, b),
  "pdf-to-epub",
);
const pdfToPptx = withSingle((p) => extConverters.pdfToPptx(p), "pdf-to-pptx");
const pdfToExcel = withSingle(
  (p) => extConverters.pdfToExcel(p),
  "pdf-to-excel",
);

const heicToJpg = withSingle((p) => extConverters.heicToJpg(p), "heic-to-jpg");
const gifToPdf = withSingle((p) => extConverters.gifToPdf(p), "gif-to-pdf");
const markdownToPdf = withSingle(
  (p) => extConverters.markdownToPdf(p),
  "markdown-to-pdf",
);
const csvToPdf = withSingle((p) => extConverters.csvToPdf(p), "csv-to-pdf");
const htmlToPdf = withSingle((p) => extConverters.htmlToPdf(p), "html-to-pdf");
const svgToPdf = withSingle((p) => extConverters.svgToPdf(p), "svg-to-pdf");

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
  // Advanced PDF
  pdfToJpg,
  watermarkPdf,
  signPdf,
  redactPdf,
  addPageNumbers,
  pdfToPdfa,
  comparePdfs,
  performOcr,
  // Extended converters
  pdfToTxt,
  pdfToMarkdown,
  pdfToJson,
  pdfToXml,
  pdfToCsv,
  pdfToEpub,
  pdfToPptx,
  pdfToExcel,
  heicToJpg,
  gifToPdf,
  markdownToPdf,
  csvToPdf,
  htmlToPdf,
  svgToPdf,
  // New tools
  unlockPdf,
  protectPdf,
  organizePdf,
};

// ── Unlock PDF ────────────────────────────────────────────────────────────────
async function unlockPdf(req, res, next) {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);
    const { password = "" } = req.body;
    const result = await pdfService.unlockPdf(req.file.path, password);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size,
    };
    await logConversion(
      req,
      "unlock-pdf",
      [req.file],
      out,
      "completed",
      null,
      startMs,
    );
    cleanup(req.file.path);
    success(res, out, "PDF unlocked successfully");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    await logConversion(
      req,
      "unlock-pdf",
      req.file ? [req.file] : [],
      null,
      "failed",
      err.message,
      startMs,
    );
    next(err);
  }
}

// ── Protect PDF ────────────────────────────────────────────────────────────────
async function protectPdf(req, res, next) {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);
    const { userPassword, ownerPassword } = req.body;
    if (!userPassword || userPassword.length < 4)
      return error(res, "userPassword must be at least 4 characters", 400);
    const result = await pdfService.protectPdf(
      req.file.path,
      userPassword,
      ownerPassword || userPassword,
    );
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size,
    };
    await logConversion(
      req,
      "protect-pdf",
      [req.file],
      out,
      "completed",
      null,
      startMs,
    );
    cleanup(req.file.path);
    success(res, out, "PDF protected successfully");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    await logConversion(
      req,
      "protect-pdf",
      req.file ? [req.file] : [],
      null,
      "failed",
      err.message,
      startMs,
    );
    next(err);
  }
}

// ── Organize PDF ───────────────────────────────────────────────────────────────
async function organizePdf(req, res, next) {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);
    let pageOrder = req.body.pageOrder;
    if (typeof pageOrder === "string") {
      // Accepts "1,3,2" or JSON "[1,3,2]"
      try {
        pageOrder = JSON.parse(pageOrder);
      } catch {
        pageOrder = pageOrder.split(",").map(Number);
      }
    }
    if (!Array.isArray(pageOrder) || !pageOrder.length)
      return error(
        res,
        "pageOrder must be a non-empty array of page numbers",
        400,
      );
    const result = await pdfService.organizePdf(req.file.path, pageOrder);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size,
      pageCount: result.pageCount,
    };
    await logConversion(
      req,
      "organize-pdf",
      [req.file],
      out,
      "completed",
      null,
      startMs,
    );
    cleanup(req.file.path);
    success(res, out, "PDF organized successfully");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    await logConversion(
      req,
      "organize-pdf",
      req.file ? [req.file] : [],
      null,
      "failed",
      err.message,
      startMs,
    );
    next(err);
  }
}
