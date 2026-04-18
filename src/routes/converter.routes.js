"use strict";
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/converter.controller");
const { optionalAuth } = require("../middleware/auth.middleware");
const { conversionRateLimiter } = require("../middleware/rateLimit.middleware");

router.use(optionalAuth);
router.use(conversionRateLimiter);

// ── Original tools ────────────────────────────────────────────────────────────
router.post("/image-to-pdf", ctrl.imageToPdf);
router.post("/pdf-to-word", ctrl.pdfToWord);
router.post("/word-to-pdf", ctrl.wordToPdf);
router.post("/pdf-merge", ctrl.pdfMerge);
router.post("/pdf-split", ctrl.pdfSplit);
router.post("/pdf-compress", ctrl.pdfCompress);
router.post("/image-resize", ctrl.imageResize);
router.post("/image-compress", ctrl.imageCompress);
router.post("/image-convert", ctrl.imageConvert);
router.post("/text-to-pdf", ctrl.textToPdf);
router.post("/create-zip", ctrl.createZip);

// ── Advanced PDF tools ────────────────────────────────────────────────────────
router.post("/pdf-to-jpg", ctrl.pdfToJpg);
router.post("/watermark-pdf", ctrl.watermarkPdf);
router.post("/sign-pdf", ctrl.signPdf);
router.post("/redact-pdf", ctrl.redactPdf);
router.post("/page-numbers", ctrl.addPageNumbers);
router.post("/add-page-numbers", ctrl.addPageNumbers);
router.post("/pdf-to-pdfa", ctrl.pdfToPdfa);
router.post("/compare-pdfs", ctrl.comparePdfs);
router.post("/ocr", ctrl.performOcr);

// ── Extended converters ───────────────────────────────────────────────────────
router.post("/pdf-to-txt", ctrl.pdfToTxt);
router.post("/pdf-to-markdown", ctrl.pdfToMarkdown);
router.post("/pdf-to-json", ctrl.pdfToJson);
router.post("/pdf-to-xml", ctrl.pdfToXml);
router.post("/pdf-to-csv", ctrl.pdfToCsv);
router.post("/pdf-to-epub", ctrl.pdfToEpub);
router.post("/pdf-to-pptx", ctrl.pdfToPptx);
router.post("/pdf-to-excel", ctrl.pdfToExcel);
router.post("/heic-to-jpg", ctrl.heicToJpg);
router.post("/gif-to-pdf", ctrl.gifToPdf);
router.post("/markdown-to-pdf", ctrl.markdownToPdf);
router.post("/csv-to-pdf", ctrl.csvToPdf);
router.post("/html-to-pdf", ctrl.htmlToPdf);
router.post("/svg-to-pdf", ctrl.svgToPdf);

// ── New tools ─────────────────────────────────────────────────────────────────
router.post("/unlock-pdf", ctrl.unlockPdf);
router.post("/protect-pdf", ctrl.protectPdf);
router.post("/organize-pdf", ctrl.organizePdf);

module.exports = router;
