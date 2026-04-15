"use strict";
const fse = require("fs-extra");
const path = require("path");
const { handleSingleUpload } = require("../config/multer");
const aiService = require("../services/ai.service");
const Job = require("../models/Job");
const User = require("../models/User");
const ConversionHistory = require("../models/ConversionHistory");
const { success, error } = require("../utils/response");
const { deleteFile } = require("../utils/fileCleanup");
const { SUBSCRIPTION_PLANS } = require("../config/constants");
const logger = require("../utils/logger");

// Persistent chat sessions (in-memory for now; use Redis in production)
const chatSessions = new Map();

const checkAiLimit = async (user) => {
  if (!user) return true; // anonymous — check based on IP elsewhere
  const plan = user.subscription?.plan || "free";
  const limits = SUBSCRIPTION_PLANS[plan];
  if (limits.aiRequestsPerDay === -1) return true; // unlimited
  return user.usage.aiRequestsToday < limits.aiRequestsPerDay;
};

const incrementAiUsage = async (userId) => {
  if (!userId) return;
  await User.findByIdAndUpdate(userId, {
    $inc: { "usage.aiRequestsToday": 1 },
  });
};

// POST /api/ai/summarize
const summarizePdf = async (req, res, next) => {
  try {
    if (req.user && !(await checkAiLimit(req.user)))
      return error(
        res,
        "AI request limit reached for your plan. Upgrade to continue.",
        429,
      );

    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);

    const { length = "medium", language = "English" } = req.body;
    const result = await aiService.summarizePdf(req.file.path, {
      length,
      language,
    });
    await incrementAiUsage(req.user?._id);
    deleteFile(req.file.path);

    await ConversionHistory.create({
      user: req.user?._id,
      tool: "ai-summarize",
      status: "completed",
      inputFiles: [
        {
          originalName: req.file.originalname,
          size: req.file.size,
          mimeType: req.file.mimetype,
        },
      ],
      aiTokensUsed: result.tokensUsed,
      ipAddress: req.ip,
    });
    success(res, result, "PDF summarized successfully");
  } catch (err) {
    if (req.file) deleteFile(req.file.path);
    next(err);
  }
};

// POST /api/ai/chat  (session-based)
const chatWithPdf = async (req, res, next) => {
  try {
    const { sessionId, question, message } = req.body;
    const q = question || message;
    if (!q) return error(res, "Question is required", 400);

    // Retrieve existing session context
    const session = chatSessions.get(sessionId) || {
      pdfPath: null,
      history: [],
    };

    // If a new file is uploaded, overwrite session
    if (req.file) {
      if (session.pdfPath) deleteFile(session.pdfPath);
      session.pdfPath = req.file.path;
      session.history = [];
    }
    if (!session.pdfPath)
      return error(
        res,
        "No PDF loaded for this session. Upload a PDF first.",
        400,
      );

    if (req.user && !(await checkAiLimit(req.user)))
      return error(res, "AI request limit reached for your plan.", 429);

    const result = await aiService.chatWithPdf(
      session.pdfPath,
      q,
      session.history,
    );
    session.history.push({ role: "user", content: q });
    session.history.push({ role: "assistant", content: result.answer });
    chatSessions.set(sessionId, session);

    await incrementAiUsage(req.user?._id);
    success(res, { answer: result.answer, tokensUsed: result.tokensUsed });
  } catch (err) {
    next(err);
  }
};

// POST /api/ai/chat/upload  (upload PDF for chat session)
const uploadChatPdf = async (req, res, next) => {
  try {
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);
    const { v4: uuidv4 } = require("uuid");
    const sessionId = uuidv4();
    chatSessions.set(sessionId, { pdfPath: req.file.path, history: [] });
    // Clean up sessions older than 1 hour to prevent leaks
    if (chatSessions.size > 1000) {
      const keys = [...chatSessions.keys()];
      keys.slice(0, 100).forEach((k) => {
        const sess = chatSessions.get(k);
        if (sess?.pdfPath) deleteFile(sess.pdfPath);
        chatSessions.delete(k);
      });
    }
    success(
      res,
      { sessionId, fileName: req.file.originalname },
      "PDF uploaded for chat",
    );
  } catch (err) {
    if (req.file) deleteFile(req.file.path);
    next(err);
  }
};

// POST /api/ai/extract-keywords
const extractKeywords = async (req, res, next) => {
  try {
    if (req.user && !(await checkAiLimit(req.user)))
      return error(res, "AI request limit reached.", 429);
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);
    const result = await aiService.extractKeywords(req.file.path);
    await incrementAiUsage(req.user?._id);
    deleteFile(req.file.path);
    success(res, result, "Keywords extracted");
  } catch (err) {
    if (req.file) deleteFile(req.file.path);
    next(err);
  }
};

// POST /api/ai/form-fill
const extractFormData = async (req, res, next) => {
  try {
    if (req.user && !(await checkAiLimit(req.user)))
      return error(res, "AI request limit reached.", 429);
    await handleSingleUpload(req, res);
    if (!req.file) return error(res, "No PDF uploaded", 400);
    const result = await aiService.extractFormData(req.file.path);
    await incrementAiUsage(req.user?._id);
    deleteFile(req.file.path);
    success(res, result, "Form data extracted");
  } catch (err) {
    if (req.file) deleteFile(req.file.path);
    next(err);
  }
};

module.exports = {
  summarizePdf,
  chatWithPdf,
  uploadChatPdf,
  extractKeywords,
  extractFormData,
};
