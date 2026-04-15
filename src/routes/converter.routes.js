"use strict";

const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/converter.controller");
const { optionalAuth } = require("../middleware/auth.middleware");
const { conversionRateLimiter } = require("../middleware/rateLimit.middleware");

// All conversion routes share: optional-auth + per-minute rate limit
router.use(optionalAuth);
router.use(conversionRateLimiter);

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

module.exports = router;
