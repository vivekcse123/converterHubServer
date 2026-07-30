"use strict";
const express    = require("express");
const rateLimit  = require("express-rate-limit");
const { protect: authenticate } = require("../middleware/auth.middleware");
const { generatePdf, generateDocx, renderHtml } = require("../controllers/resume.controller");

const router = express.Router();

// 10 PDFs per 10 minutes per user
const pdfRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: { success: false, message: "Too many PDF requests. Please wait a few minutes before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/resume/pdf — legacy pdfmake-based generation
router.post("/pdf", authenticate, pdfRateLimit, generatePdf);

// POST /api/resume/render-html — Puppeteer pixel-perfect PDF from live DOM
router.post("/render-html", authenticate, pdfRateLimit, renderHtml);

// POST /api/resume/docx — Word (.docx) export built from structured resume data
router.post("/docx", authenticate, pdfRateLimit, generateDocx);

module.exports = router;
