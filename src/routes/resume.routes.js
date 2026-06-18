"use strict";
const express    = require("express");
const rateLimit  = require("express-rate-limit");
const { protect: authenticate } = require("../middleware/auth.middleware");
const { generatePdf }  = require("../controllers/resume.controller");

const router = express.Router();

// 10 PDFs per 10 minutes per user (generous for free, enforced server-side)
const pdfRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: { success: false, message: "Too many PDF requests. Please wait a few minutes before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/resume/pdf — server-side PDF generation with access control + watermark
router.post("/pdf", authenticate, pdfRateLimit, generatePdf);

module.exports = router;
