"use strict";
const { handleSingleUpload } = require("../config/multer");
const { deleteFile } = require("../utils/fileCleanup");
const aiService = require("../services/ai.service");
const AtsReport = require("../models/AtsReport");
const User = require("../models/User");
const { success, error } = require("../utils/response");
const { SUBSCRIPTION_PLANS } = require("../config/constants");
const logger = require("../utils/logger");

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Separate from the general AI daily quota — the ATS Checker is a headline
 *  feature with its own budget. Anonymous users skip this (bounded instead by
 *  the router's shared per-IP aiRateLimiter), matching every other
 *  anonymous-usable AI endpoint's convention in ai.controller.js. */
const checkAtsScanLimit = (user) => {
  if (!user) return true;
  const rawPlan = user.subscription?.plan || "free";
  const planTier = ["monthly", "yearly", "lifetime"].includes(rawPlan)
    ? "pro"
    : (SUBSCRIPTION_PLANS[rawPlan] ? rawPlan : "free");
  const limits = SUBSCRIPTION_PLANS[planTier];
  if (limits.atsScansPerDay === -1) return true;
  return (user.usage?.atsScansToday ?? 0) < limits.atsScansPerDay;
};

const incrementAtsScanUsage = async (userId) => {
  if (!userId) return;
  await User.findByIdAndUpdate(userId, { $inc: { "usage.atsScansToday": 1 } });
};

// POST /api/ai/ats/analyze — multipart file upload OR { text } JSON body
const analyzeResume = async (req, res, next) => {
  let uploadedPath;
  try {
    if (!checkAtsScanLimit(req.user)) {
      return error(res, "You've used your free ATS scans for today. Upgrade for more.", 429);
    }

    // Text-paste path: no file, body already parsed as JSON.
    let resumeText = typeof req.body?.text === "string" ? req.body.text : "";
    let fileName;

    if (!resumeText.trim()) {
      await handleSingleUpload(req, res);
      if (!req.file) return error(res, "Upload a resume file or paste its text.", 400);
      uploadedPath = req.file.path;
      fileName = req.file.originalname;

      if (req.file.mimetype === "application/pdf") {
        resumeText = await aiService.extractPdfText(req.file.path);
      } else if (req.file.mimetype === DOCX_MIME) {
        resumeText = await aiService.extractDocxText(req.file.path);
      } else if (req.file.mimetype === "text/plain") {
        const fse = require("fs-extra");
        resumeText = (await fse.readFile(req.file.path, "utf8")).slice(0, 12_000);
      } else {
        return error(res, "Unsupported file type — upload a PDF, DOCX, or plain text file.", 400);
      }
    }

    if (!resumeText || resumeText.trim().length < 30) {
      return error(res, "Couldn't find enough readable text in this resume. Try a different file or paste the text directly.", 400);
    }

    const result = await aiService.analyzeUploadedResume({ resumeText });

    const report = await AtsReport.create({
      userId: req.user?._id,
      fileName,
      ...result,
    });

    await incrementAtsScanUsage(req.user?._id);

    success(res, { reportId: report._id, report }, "Resume analyzed");
  } catch (err) {
    logger.error(`[ATS Checker] analyze failed: ${err.message}`);
    next(err);
  } finally {
    if (uploadedPath) deleteFile(uploadedPath);
  }
};

// GET /api/ai/ats/report/:id — instant reload, no re-analysis
const getReport = async (req, res, next) => {
  try {
    const report = await AtsReport.findById(req.params.id).lean();
    if (!report) return error(res, "Report not found", 404);
    // Only enforce ownership when the report actually belongs to someone —
    // anonymous-created reports stay openable by anyone with the link,
    // matching the anonymous-scan-allowed design.
    if (report.userId && (!req.user || String(report.userId) !== String(req.user._id))) {
      return error(res, "You don't have access to this report", 403);
    }
    success(res, { report });
  } catch (err) {
    next(err);
  }
};

module.exports = { analyzeResume, getReport };
