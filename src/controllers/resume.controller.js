"use strict";
const { generatePdfBuffer, PREMIUM_TEMPLATE_IDS } = require("../services/resume-pdf.service");
const ResumeDownloadLog = require("../models/ResumeDownloadLog");
const { error } = require("../utils/response");
const logger = require("../utils/logger");

const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900" +
  "&family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400" +
  "&family=Georgia&display=swap";

// ── Puppeteer browser singleton ───────────────────────────────────────────────
let _browser = null;

async function getBrowser() {
  if (_browser?.isConnected()) return _browser;
  const puppeteer = require("puppeteer");

  // PUPPETEER_EXECUTABLE_PATH is set in the Dockerfile (Alpine Chromium) or
  // via Render env vars. Fall back to Puppeteer's own bundled Chrome on dev.
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  _browser = await puppeteer.launch({
    headless: "new",
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--single-process",
    ],
  });
  _browser.on("disconnected", () => { _browser = null; });
  return _browser;
}

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

/**
 * POST /api/resume/render-html
 * Accepts the live-rendered resume DOM (HTML string) + linked CSS URLs.
 * Puppeteer renders it in headless Chrome and returns a pixel-perfect A4 PDF.
 */
const renderHtml = async (req, res, next) => {
  const {
    html         = "",
    cssUrls      = [],
    inlineStyles = "",
    cssVarsCss   = "",
    filename     = "resume",
  } = req.body;

  if (!html) return error(res, "html is required", 400);

  // Server-side watermark decision — never trust the client
  const userIsPro = isPro(req.user);
  const watermarkCss = userIsPro ? "" : `
    body::after {
      content: 'ApnaConverter.com  \\2022  Upgrade to Pro';
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(-25deg);
      font-size: 18pt; font-family: Arial, sans-serif;
      color: rgba(0,0,0,0.07); white-space: nowrap;
      pointer-events: none; z-index: 99999;
    }
  `;

  // All CSS is sent inline by the browser — no external CSS URLs needed.
  // Puppeteer only fetches Google Fonts from the hardcoded <link>.
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${GOOGLE_FONTS_URL}" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 0; }
    html, body { margin: 0; padding: 0; width: 210mm; background: white; color-scheme: light; }
    *, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .page-break-line, .page-break-label { display: none !important; }
    .preview-page-host, .shadow-card { box-shadow: none !important; }
    :root { ${cssVarsCss} }
    ${inlineStyles}
    /* Fix: force full-bleed headers to exactly A4 width (avoids 1px rounding gap on right edge) */
    .modern-header {
      width: 210mm !important;
      margin-left: -16mm !important;
      margin-top: -14mm !important;
      box-sizing: border-box !important;
    }
    ${watermarkCss}
  </style>
</head>
<body>${html}</body>
</html>`;

  const safeFilename = String(filename).replace(/[^a-z0-9-_]/gi, "-").slice(0, 100);
  const ip        = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "";
  const userAgent = req.headers["user-agent"] || "";

  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Set viewport to A4 at 96 DPI (210mm × 297mm).
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });

    // Use screen media so @media print rules don't strip the template's
    // padding (print.css resets padding:0 on .resume-page for the old
    // window.print() path — we want the designed screen layout instead).
    await page.emulateMediaType("screen");

    // Load the complete HTML with all CSS already inlined.
    await page.setContent(fullHtml, { waitUntil: "load", timeout: 30_000 });

    // Wait for web fonts (Google Fonts) to finish rendering.
    await page.evaluate(() => document.fonts.ready);
    // Extra safety buffer for font swap + final layout pass.
    await new Promise(r => setTimeout(r, 400));

    const rawPdf = await page.pdf({
      format:          "A4",
      printBackground: true,
      margin:          { top: 0, right: 0, bottom: 0, left: 0 },
    });

    // Newer Puppeteer versions return Uint8Array instead of Buffer.
    // Express's res.send() only handles Buffer correctly as binary.
    const pdfBuffer = Buffer.isBuffer(rawPdf) ? rawPdf : Buffer.from(rawPdf);

    res.setHeader("Content-Type",        "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}.pdf"`);
    res.setHeader("Content-Length",      pdfBuffer.length);
    res.setHeader("Cache-Control",       "no-store");
    res.send(pdfBuffer);

    ResumeDownloadLog.create({
      userId:            req.user._id,
      templateId:        "render-html",
      templateName:      "Direct HTML Render",
      isPremiumTemplate: false,
      planType:          getUserPlanType(req.user),
      action:            "download",
      success:           true,
      blocked:           false,
      ip, userAgent,
      resumeName:        safeFilename,
    }).catch(() => {});

  } catch (err) {
    logger.error("Puppeteer PDF error:", err.message);
    next(err);
  } finally {
    if (page) { try { await page.close(); } catch {} }
  }
};

module.exports = { generatePdf, getDownloadLogs, renderHtml };
