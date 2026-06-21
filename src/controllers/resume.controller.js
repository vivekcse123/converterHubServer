"use strict";
const { generatePdfBuffer, PREMIUM_TEMPLATE_IDS } = require("../services/resume-pdf.service");
const ResumeDownloadLog = require("../models/ResumeDownloadLog");
const { error } = require("../utils/response");

const TEMPLATE_NAMES = {
  "ats-professional":    "ATS Professional",
  "modern-professional": "Modern Professional",
  "fresher":             "Fresher / Entry-Level",
  "executive":           "Executive",
  "creative":            "Creative",
  "minimal":             "Minimal",
  "tech":                "Tech",
  "elegant":             "Elegant",
  "compact":             "Compact",
  "bold":                "Bold",
};

function getUserPlanType(user) {
  const isAdmin = ["admin", "superadmin"].includes(user?.role);
  if (isAdmin) return "admin";
  const sub = user?.subscription;
  if (sub?.status === "active") return sub.plan || "monthly";
  return "free";
}

function isPro(user) {
  const planType = getUserPlanType(user);
  return ["monthly", "yearly", "lifetime", "admin"].includes(planType);
}

function hasPurchasedTemplate(user, templateId) {
  return (user?.templatePurchases ?? []).some(p => p.templateId === templateId);
}

/**
 * POST /api/resume/pdf
 * Body: { resume: ResumeData, templateId: string, resumeName?: string }
 * Returns: PDF binary (application/pdf)
 */
const generatePdf = async (req, res) => {
  const { resume, templateId, resumeName } = req.body;

  if (!resume || !templateId) {
    return error(res, "resume and templateId are required", 400);
  }

  const userIsPro       = isPro(req.user);
  const isPremiumTmpl   = PREMIUM_TEMPLATE_IDS.includes(templateId);
  const planType        = getUserPlanType(req.user);
  const ip              = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "";
  const userAgent       = req.headers["user-agent"] || "";

  // ── Block non-Pro users from premium templates (unless they purchased individually) ────
  const templatePurchased = hasPurchasedTemplate(req.user, templateId);
  if (isPremiumTmpl && !userIsPro && !templatePurchased) {
    await ResumeDownloadLog.create({
      userId:            req.user._id,
      templateId,
      templateName:      TEMPLATE_NAMES[templateId] || templateId,
      isPremiumTemplate: true,
      planType,
      action:            "blocked",
      success:           false,
      blocked:           true,
      reason:            "Premium template requires Pro subscription",
      ip,
      userAgent,
      resumeName:        resumeName || "Untitled",
    }).catch(() => {}); // don't fail the request if logging fails

    return error(
      res,
      "This template requires a Pro subscription. Upgrade at /resume-builder/pricing.",
      403
    );
  }

  // ── Generate PDF ─────────────────────────────────────────────────────────────
  let pdfBuffer;
  try {
    pdfBuffer = await generatePdfBuffer(resume, templateId, userIsPro);
  } catch (err) {
    console.error("PDF generation error:", err);
    return error(res, "PDF generation failed. Please try again.", 500);
  }

  // ── Log the download ─────────────────────────────────────────────────────────
  await ResumeDownloadLog.create({
    userId:            req.user._id,
    templateId,
    templateName:      TEMPLATE_NAMES[templateId] || templateId,
    isPremiumTemplate: isPremiumTmpl,
    planType,
    action:            "download",
    success:           true,
    blocked:           false,
    ip,
    userAgent,
    resumeName:        resumeName || "Untitled",
  }).catch(() => {});

  // ── Return PDF ────────────────────────────────────────────────────────────────
  const filename = `${(resumeName || "resume").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.setHeader("Cache-Control", "no-store");
  return res.send(pdfBuffer);
};

/**
 * GET /api/admin/resume-logs
 * Returns paginated download logs for admin audit.
 */
const getDownloadLogs = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.templateId) filter.templateId = req.query.templateId;
    if (req.query.action)     filter.action      = req.query.action;
    if (req.query.planType)   filter.planType     = req.query.planType;
    if (req.query.blocked === "true") filter.blocked = true;

    const [logs, total] = await Promise.all([
      ResumeDownloadLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "name email")
        .lean(),
      ResumeDownloadLog.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: { logs, total, page, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("getDownloadLogs error:", err);
    return error(res, "Failed to fetch logs", 500);
  }
};

module.exports = { generatePdf, getDownloadLogs };
