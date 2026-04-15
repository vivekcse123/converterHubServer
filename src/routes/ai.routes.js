"use strict";
const express = require("express");
const router = express.Router();
const ai = require("../controllers/ai.controller");
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

router.post("/summarize", ai.summarizePdf);
router.post("/chat/upload", ai.uploadChatPdf);
router.post("/chat", ai.chatWithPdf);
router.post("/extract-keywords", ai.extractKeywords);
router.post("/form-fill", ai.extractFormData);

module.exports = router;
