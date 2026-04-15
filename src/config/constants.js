"use strict";
const path = require("path");
const fse  = require("fs-extra");

const UPLOAD_DIR       = path.join(__dirname, "../..", process.env.UPLOAD_DIR || "uploads");
const OUTPUT_DIR       = path.join(__dirname, "../..", process.env.OUTPUT_DIR || "outputs");
const MAX_FILE_SIZE    = parseInt(process.env.MAX_FILE_SIZE, 10) || 104_857_600;  // 100 MB
const FILE_EXPIRY_HOURS = parseInt(process.env.FILE_EXPIRY_HOURS, 10) || 2;

const ALLOWED_MIME_TYPES = [
  "image/jpeg","image/jpg","image/png","image/gif","image/webp","image/bmp",
  "image/tiff","image/heic","image/heif","image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain","text/csv","text/markdown","text/html",
  "application/json","application/xml","text/xml",
  "application/epub+zip",
  "application/zip","application/x-zip-compressed",
];

const ALLOWED_EXTENSIONS = [
  ".jpg",".jpeg",".png",".gif",".webp",".bmp",".tiff",".heic",".heif",".svg",
  ".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx",
  ".txt",".csv",".md",".markdown",".html",".htm",
  ".json",".xml",".epub",".zip",
];

const PAGE_SIZES = {
  A4:     [595.28, 841.89],
  LETTER: [612, 792],
  LEGAL:  [612, 1008],
  A3:     [841.89, 1190.55],
};

const ALL_TOOLS = [
  "image-to-pdf","pdf-to-word","word-to-pdf","pdf-merge","pdf-split",
  "pdf-compress","image-resize","image-compress","image-convert","text-to-pdf","create-zip",
  "pdf-to-jpg","pdf-to-pptx","pdf-to-excel","pdf-to-pdfa","pdf-to-txt",
  "pdf-to-markdown","pdf-to-json","pdf-to-xml","pdf-to-csv","pdf-to-epub",
  "txt-to-pdf","markdown-to-pdf","json-to-pdf","csv-to-pdf","html-to-pdf",
  "ocr","watermark-pdf","sign-pdf","redact-pdf","page-numbers",
  "compare-pdfs","heic-to-jpg","gif-to-pdf","svg-to-pdf",
  "ai-summarize","ai-chat","ai-keyword-extract","ai-form-fill",
];

const SUBSCRIPTION_PLANS = {
  free:       { name: "Free",       maxFileSizeMb: 10,  conversionsPerDay: 5,   aiRequestsPerDay: 3   },
  pro:        { name: "Pro",        maxFileSizeMb: 100, conversionsPerDay: 100, aiRequestsPerDay: 50  },
  team:       { name: "Team",       maxFileSizeMb: 200, conversionsPerDay: 500, aiRequestsPerDay: 200 },
  enterprise: { name: "Enterprise", maxFileSizeMb: 500, conversionsPerDay: -1,  aiRequestsPerDay: -1  },
};

const ensureDirectories = async () => {
  await fse.ensureDir(UPLOAD_DIR);
  await fse.ensureDir(OUTPUT_DIR);
  await fse.ensureDir("logs");
  await fse.ensureDir(path.join(UPLOAD_DIR, "temp"));
};

module.exports = {
  UPLOAD_DIR, OUTPUT_DIR, MAX_FILE_SIZE, FILE_EXPIRY_HOURS,
  ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, PAGE_SIZES,
  ALL_TOOLS, SUBSCRIPTION_PLANS, ensureDirectories,
};
