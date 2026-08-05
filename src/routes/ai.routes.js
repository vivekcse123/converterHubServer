"use strict";
const express = require("express");
const router = express.Router();
const ai = require("../controllers/ai.controller");
const atsChecker = require("../controllers/atsChecker.controller");
const { optionalAuth } = require("../middleware/auth.middleware");
const rateLimit = require("express-rate-limit");

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: "Too many AI requests. Please wait a minute.",
  },
});

router.use(optionalAuth);
router.use(aiRateLimiter);

router.post("/summarize",           ai.summarizePdf);
router.post("/chat/upload",         ai.uploadChatPdf);
router.post("/chat",                ai.chatWithPdf);
router.post("/extract-keywords",    ai.extractKeywords);
router.post("/form-fill",           ai.extractFormData);
router.post("/resume/bullets",      ai.resumeBullets);
router.post("/resume/cover-letter", ai.coverLetter);
router.post("/resume/transform",    ai.transformText);
router.post("/resume/ats-analyze",  ai.atsAnalyze);

// ATS Resume Checker — deep analysis of an uploaded/pasted resume (distinct
// from /resume/ats-analyze above, which audits the Resume Builder's own
// structured data).
router.post("/ats/analyze",   atsChecker.analyzeResume);
router.get("/ats/report/:id", atsChecker.getReport);

router.post("/portfolio/bio",                ai.portfolioBio);
router.post("/portfolio/project-description", ai.portfolioProjectDescription);
router.post("/portfolio/rewrite",             ai.portfolioRewrite);

module.exports = router;
