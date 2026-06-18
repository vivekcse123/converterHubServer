"use strict";
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const path = require("path");

const {
  errorHandler,
  notFoundHandler,
} = require("./middleware/error.middleware");
const { globalRateLimiter } = require("./middleware/rateLimit.middleware");

const authRoutes = require("./routes/auth.routes");
const converterRoutes = require("./routes/converter.routes");
const historyRoutes = require("./routes/history.routes");
const adminRoutes = require("./routes/admin.routes");
// AI routes disabled — no OpenAI key configured
// const aiRoutes     = require("./routes/ai.routes");
const jobsRoutes     = require("./routes/jobs.routes");
const trendingRoutes = require("./routes/trending.routes");
const paymentRoutes      = require("./routes/payment.routes");
const subscriptionRoutes = require("./routes/subscription.routes");
const webhookRoutes      = require("./routes/webhook.routes");
const careerRoutes       = require("./routes/career.routes");
const shareRoutes        = require("./routes/share.routes");
const publicRoutes       = require("./routes/public.routes");
const resumeRoutes       = require("./routes/resume.routes");
const logger = require("./utils/logger");

const app = express();

// Trust Render/Vercel reverse proxy so req.protocol returns https
app.set("trust proxy", 1);

// ── Security ─────────────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // API-only server — responses are JSON, not HTML. Use a restrictive CSP
    // that blocks any accidental HTML rendering from injecting scripts.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc:  ["'none'"],
        objectSrc:  ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // Tell clients to only connect over HTTPS for the next year
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
  }),
);

// app.use(cors({
//   origin: [
//     (
//       "https://converter-hub-eight.vercel.app",
//       "http://localhost:4200"
//     )
//   ],
//   credentials:  true,
//   methods:      ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
//   allowedHeaders: ["Content-Type","Authorization","X-Session-ID"],
// }));

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Always include these origins; env var can add more.
// localhost:4200 is only allowed in non-production to prevent accidental
// cross-origin access from developer machines in prod.
const corsOrigins = [
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:4200"] : []),
  "https://converter-hub-eight.vercel.app",
  "https://www.apnaconverter.com",
  "https://apnaconverter.com",
  ...allowedOrigins,
];

app.use(
  cors({
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// ── Request timeout (5 min — enough for large file conversions) ───────────────
app.use((req, res, next) => {
  res.setTimeout(5 * 60 * 1_000, () => {
    if (!res.headersSent) {
      res.status(408).json({ success: false, message: "Request timed out." });
    }
  });
  next();
});

// ── Compression & Parsing ─────────────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(
  morgan("combined", {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === "/health" || req.url === "/ping",
  }),
);

// ── Rate Limiting ─────────────────────────────────────────────────────────────
app.use("/api/", globalRateLimiter);

// ── Static Files (output downloads) ──────────────────────────────────────────
app.use(
  "/outputs",
  express.static(path.join(__dirname, "..", "outputs"), {
    setHeaders: (res, filePath) => {
      const fileName = path.basename(filePath);
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Allow browsers to cache output files for 10 minutes so re-downloads
      // are instant; files are UUID-named so there is no stale-cache risk.
      res.setHeader("Cache-Control", "private, max-age=600");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    },
  }),
);

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || "2.0.0",
  });
});

// ── Keep-alive ping ───────────────────────────────────────────────────────────
app.get("/ping", (_req, res) => res.json({ pong: true, ts: Date.now() }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/convert", converterRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/admin", adminRoutes);
// app.use("/api/ai",       aiRoutes);  // disabled — no OpenAI key
app.use("/api/jobs",      jobsRoutes);
app.use("/api/converters", trendingRoutes);
app.use("/api/payments",      paymentRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/webhooks",      webhookRoutes);
app.use("/api/career",        careerRoutes);
app.use("/api/share",         shareRoutes);
app.use("/api/public",        publicRoutes);
app.use("/api/resume",        resumeRoutes);

// ── Error Handlers ────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
