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

/**
 * Verify the output file exists and has content.
 * Throws a descriptive error if missing or empty.
 */
const verifyOutput = async (outputPath) => {
  if (!outputPath) return;
  let stat;
  try {
    stat = await fse.stat(outputPath);
  } catch {
    throw Object.assign(
      new Error("Conversion produced no output file. The input may be unsupported or corrupted."),
      { statusCode: 500 },
    );
  }
  if (stat.size === 0) {
    await fse.remove(outputPath).catch(() => {});
    throw Object.assign(
      new Error("Conversion produced an empty output file. Please verify your input and try again."),
      { statusCode: 500 },
    );
  }
};

const withSingle = (fn, tool) => async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No file uploaded", 400);
    const result = await fn(req.file.path, req.body);

    await verifyOutput(result.outputPath);

    const stat = await fse.stat(result.outputPath).catch(() => ({ size: result.size || 0 }));
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size || stat.size,
      ...result,
    };
    delete out.outputPath;
    // Respond immediately — don't block the client waiting for DB logging.
    cleanup(req.file.path);
    success(res, out, "Conversion successful");
    logConversion(req, tool, [req.file], out, "completed", null, startMs);
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    next(err);
    logConversion(req, tool, req.file ? [req.file] : [], null, "failed", err.message, startMs);
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

    await verifyOutput(result.outputPath);

    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size,
      ...result,
    };
    delete out.outputPath;
    // Respond immediately — don't block the client waiting for DB logging.
    req.files.forEach((f) => cleanup(f.path));
    success(res, out, "Conversion successful");
    logConversion(req, tool, req.files, out, "completed", null, startMs);
  } catch (err) {
    if (req.files) req.files.forEach((f) => cleanup(f.path));
    next(err);
    logConversion(req, tool, req.files || [], null, "failed", err.message, startMs);
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
    await verifyOutput(result.outputPath);
    const stat = await fse.stat(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: stat.size,
    };
    logConversion(
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
    logConversion(req, "image-to-pdf", req.files || [], null, "failed", err.message, startMs);
    next(err);
  }
};

const pdfToWord = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF file uploaded", 400);
    const result = await pdfService.pdfToWord(req.file.path);
    await verifyOutput(result.outputPath);
    const stat = await fse.stat(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: stat.size,
    };
    logConversion(
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
    logConversion(req, "pdf-to-word", req.file ? [req.file] : [], null, "failed", err.message, startMs);
    next(err);
  }
};

const wordToPdf = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No Word file uploaded", 400);
    const result = await pdfService.wordToPdf(req.file.path);
    await verifyOutput(result.outputPath);
    const stat = await fse.stat(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: stat.size,
    };
    logConversion(
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
    logConversion(req, "word-to-pdf", req.file ? [req.file] : [], null, "failed", err.message, startMs);
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
    await verifyOutput(result.outputPath);
    const stat = await fse.stat(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: stat.size,
    };
    logConversion(
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
    logConversion(req, "pdf-merge", req.files || [], null, "failed", err.message, startMs);
    next(err);
  }
};

const pdfSplit = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);
    const pageFiles = await pdfService.splitPdf(req.file.path);
    if (!pageFiles?.length) {
      throw Object.assign(
        new Error("Could not split the PDF. The file may be empty or corrupted."),
        { statusCode: 500 },
      );
    }
    const zipResult = await compressionService.zipPdfPages(pageFiles);
    await verifyOutput(zipResult.outputPath || (zipResult.fileName ? path.join(require("../config/constants").OUTPUT_DIR, zipResult.fileName) : null));
    const out = {
      fileName: zipResult.fileName,
      downloadUrl: buildDownloadUrl(req, zipResult.fileName),
      size: zipResult.size,
      pageCount: pageFiles.length,
    };
    logConversion(req, "pdf-split", [req.file], out, "completed", null, startMs);
    cleanup(req.file.path);
    pageFiles.forEach((f) => cleanup(f.filePath));
    success(res, out, `PDF split into ${pageFiles.length} pages`);
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    logConversion(req, "pdf-split", req.file ? [req.file] : [], null, "failed", err.message, startMs);
    next(err);
  }
};

const pdfCompress = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);
    const result = await pdfService.compressPdf(req.file.path);
    await verifyOutput(result.outputPath);
    const out = { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) };
    delete out.outputPath;
    logConversion(req, "pdf-compress", [req.file], out, "completed", null, startMs);
    cleanup(req.file.path);
    success(res, out, "PDF compressed");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    logConversion(req, "pdf-compress", req.file ? [req.file] : [], null, "failed", err.message, startMs);
    next(err);
  }
};

const imageResize = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No image uploaded", 400);
    const { width, height, fit } = req.body;
    const result = await imageService.resizeImage(req.file.path, {
      width,
      height,
      fit,
    });
    await verifyOutput(result.outputPath);
    const out = { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) };
    delete out.outputPath;
    logConversion(req, "image-resize", [req.file], out, "completed", null, startMs);
    cleanup(req.file.path);
    success(res, out, "Image resized");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    logConversion(req, "image-resize", req.file ? [req.file] : [], null, "failed", err.message, startMs);
    next(err);
  }
};

const imageCompress = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No image uploaded", 400);
    const { quality = 75, format } = req.body;
    const result = await imageService.compressImage(req.file.path, {
      quality,
      format,
    });
    await verifyOutput(result.outputPath);
    const out = { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) };
    delete out.outputPath;
    logConversion(req, "image-compress", [req.file], out, "completed", null, startMs);
    cleanup(req.file.path);
    success(res, out, "Image compressed");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    logConversion(req, "image-compress", req.file ? [req.file] : [], null, "failed", err.message, startMs);
    next(err);
  }
};

const imageConvert = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No image uploaded", 400);
    const { format = "jpeg" } = req.body;
    const result = await imageService.convertImageFormat(req.file.path, format);
    await verifyOutput(result.outputPath);
    const out = { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) };
    delete out.outputPath;
    logConversion(req, "image-convert", [req.file], out, "completed", null, startMs);
    cleanup(req.file.path);
    success(res, out, "Image converted");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    logConversion(req, "image-convert", req.file ? [req.file] : [], null, "failed", err.message, startMs);
    next(err);
  }
};

const textToPdf = async (req, res, next) => {
  const startMs = Date.now();
  try {
    const { text } = req.body;
    if (!text?.trim()) return error(res, "text field is required", 400);
    const result = await pdfService.textToPdf(text);
    await verifyOutput(result.outputPath);
    const out = { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) };
    delete out.outputPath;
    logConversion(req, "text-to-pdf", [], out, "completed", null, startMs);
    success(res, out, "Text converted to PDF");
  } catch (err) {
    logConversion(req, "text-to-pdf", [], null, "failed", err.message, startMs);
    next(err);
  }
};

const createZip = async (req, res, next) => {
  const startMs = Date.now();
  try {
    await handleMultipleUpload(req, res);
    if (!req.files?.length) return error(res, "No files uploaded", 400);
    const files = req.files.map((f) => ({
      filePath: f.path,
      archiveName: f.originalname,
    }));
    const result = await compressionService.createZip(files);
    await verifyOutput(result.outputPath);
    const out = { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) };
    delete out.outputPath;
    logConversion(req, "create-zip", req.files, out, "completed", null, startMs);
    req.files.forEach((f) => cleanup(f.path));
    success(res, out, "ZIP created");
  } catch (err) {
    if (req.files) req.files.forEach((f) => cleanup(f.path));
    logConversion(req, "create-zip", req.files || [], null, "failed", err.message, startMs);
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

    await verifyOutput(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size,
    };
    logConversion(req, "sign-pdf", [pdfFile], out, "completed", null, startMs);
    cleanup(pdfFile.path);
    if (sigFile) cleanup(sigFile.path);
    success(res, out, "PDF signed successfully");
  } catch (err) {
    if (req.files?.file?.[0])           cleanup(req.files.file[0].path);
    if (req.files?.signatureImage?.[0]) cleanup(req.files.signatureImage[0].path);
    logConversion(req, "sign-pdf", [], null, "failed", err.message, startMs);
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
    await verifyOutput(result.outputPath);
    const out = { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) };
    delete out.outputPath;
    logConversion(req, "compare-pdfs", req.files, out, "completed", null, startMs);
    req.files.forEach((f) => cleanup(f.path));
    success(res, out, "PDF comparison complete");
  } catch (err) {
    if (req.files) req.files.forEach((f) => cleanup(f.path));
    logConversion(req, "compare-pdfs", req.files || [], null, "failed", err.message, startMs);
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
    await verifyOutput(result.outputPath);
    cleanup(req.file.path);
    logConversion(
      req,
      "ocr",
      [req.file],
      result,
      "completed",
      null,
      startMs,
    );
    const out = { ...result, downloadUrl: buildDownloadUrl(req, result.fileName) };
    delete out.outputPath;
    success(res, out, "OCR complete");
  } catch (err) {
    if (req.file) cleanup(req.file.path);
    logConversion(req, "ocr", req.file ? [req.file] : [], null, "failed", err.message, startMs);
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

// ── Unlock PDF ────────────────────────────────────────────────────────────────
async function unlockPdf(req, res, next) {
  const startMs = Date.now();
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);
    const { password = "" } = req.body;
    const result = await pdfService.unlockPdf(req.file.path, password);
    await verifyOutput(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size,
    };
    logConversion(
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
    logConversion(
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
    await verifyOutput(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size,
    };
    logConversion(
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
    logConversion(
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
    await verifyOutput(result.outputPath);
    const out = {
      fileName: result.fileName,
      downloadUrl: buildDownloadUrl(req, result.fileName),
      size: result.size,
      pageCount: result.pageCount,
    };
    logConversion(
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
    logConversion(
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
