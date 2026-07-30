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
const aiRoutes = require("./routes/ai.routes");
const jobsRoutes     = require("./routes/jobs.routes");
const trendingRoutes = require("./routes/trending.routes");
const paymentRoutes      = require("./routes/payment.routes");
const subscriptionRoutes = require("./routes/subscription.routes");
const webhookRoutes      = require("./routes/webhook.routes");
const careerRoutes       = require("./routes/career.routes");
const shareRoutes        = require("./routes/share.routes");
const publicRoutes       = require("./routes/public.routes");
const resumeRoutes       = require("./routes/resume.routes");
const portfolioRoutes    = require("./routes/portfolio.routes");
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

// ── Response-time header + slow-request logging ───────────────────────────────
// Override res.end() so the header is written BEFORE the response is flushed.
// Also emits a structured warning for any request that exceeds the thresholds
// below so bottlenecks are visible in Render logs without any extra tooling.
//   SLOW     > 500 ms  (target: login/auth APIs should be < 500 ms)
//   VERY_SLOW > 1000 ms (resume generation, conversions expected here)
//   CRITICAL > 3000 ms (investigate immediately)
const SKIP_PERF_LOG = new Set(["/health", "/ping"]);
app.use((req, res, next) => {
  const start = Date.now();
  const _end = res.end.bind(res);
  res.end = function (...args) {
    const ms = Date.now() - start;
    if (!res.headersSent) {
      res.setHeader("X-Response-Time", `${ms}ms`);
    }
    if (!SKIP_PERF_LOG.has(req.path)) {
      if (ms > 3_000) {
        logger.error(`CRITICAL ${req.method} ${req.path} ${ms}ms [${res.statusCode}]`);
      } else if (ms > 1_000) {
        logger.warn(`VERY_SLOW ${req.method} ${req.path} ${ms}ms [${res.statusCode}]`);
      } else if (ms > 500) {
        logger.warn(`SLOW ${req.method} ${req.path} ${ms}ms [${res.statusCode}]`);
      }
    }
    return _end(...args);
  };
  next();
});

// ── Compression & Parsing ─────────────────────────────────────────────────────
// Use highest compression level for text/JSON — CPU cost is negligible vs latency saved.
app.use(compression({ level: 6, threshold: 512 }));
// Resume JSON bodies can be large (embedded base64 images); other API routes
// do not need more than 1 MB. Keep the global limit low and override per-route.
app.use((req, _res, next) => {
  let limit = "1mb";
  if (req.path === "/api/resume/render-html") limit = "5mb";
  else if (req.path.startsWith("/api/resume")) limit = "2mb";

  const opts = { limit };
  // The Razorpay webhook HMAC must be verified against the exact bytes
  // Razorpay sent, not `JSON.stringify(req.body)` — re-serializing the
  // already-parsed object can differ from the original payload (key order,
  // whitespace, number formatting), causing genuine webhooks to fail
  // signature checks. Stash the raw buffer here, before parsing discards it.
  if (req.path === "/api/webhooks/razorpay") {
    opts.verify = (verifyReq, _verifyRes, buf) => { verifyReq.rawBody = buf; };
  }
  express.json(opts)(req, _res, next);
});
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Logging ───────────────────────────────────────────────────────────────────
// /outputs downloads accept a JWT via `?token=` (see below) for contexts that
// can't set an Authorization header (e.g. a plain <a href> or <img src>).
// Overriding morgan's built-in `:url` token here redacts that value so
// bearer tokens never land in combined.log — applies to every route using
// the "combined" format, not just /outputs, in case any future route adds a
// similar query-string-credential pattern.
morgan.token("url", (req) => {
  if (!req.originalUrl.includes("token=")) return req.originalUrl;
  const [pathPart, query] = req.originalUrl.split("?");
  const params = new URLSearchParams(query);
  if (params.has("token")) params.set("token", "REDACTED");
  return `${pathPart}?${params.toString()}`;
});
app.use(
  morgan("combined", {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === "/health" || req.url === "/ping",
  }),
);

// ── Rate Limiting ─────────────────────────────────────────────────────────────
app.use("/api/", globalRateLimiter);

// ── Static Files (output downloads) ──────────────────────────────────────────
// Files are UUID-named so guessing is hard, but require a valid JWT to
// prevent unauthenticated access to other users' conversion outputs.
const jwt = require("jsonwebtoken");
app.use("/outputs", (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1]
      || req.query.token;
    if (!token) return res.status(401).json({ success: false, message: "Authentication required to download files." });
    jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
});
app.use(
  "/outputs",
  express.static(path.join(__dirname, "..", "outputs"), {
    setHeaders: (res, filePath) => {
      const fileName = path.basename(filePath);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    },
  }),
);

// Portfolio hero/project images — public read (unlike /outputs above), long-cache since
// filenames are content-addressed UUIDs written once by the portfolio image upload endpoint.
app.use(
  "/portfolio-media",
  express.static(path.join(__dirname, "..", "portfolio-media"), {
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }),
);

// ── Health ────────────────────────────────────────────────────────────────────
// Public: returns only a simple OK status. Internal details gated by header.
app.get("/health", async (req, res) => {
  const internalKey = process.env.HEALTH_SECRET;
  const isInternal  = internalKey && req.headers["x-health-secret"] === internalKey;

  const payload = { status: "OK", timestamp: new Date().toISOString() };

  if (isInternal) {
    const mem = process.memoryUsage();
    payload.uptime  = Math.round(process.uptime());
    payload.version = process.env.npm_package_version || "2.0.0";
    payload.memory  = {
      heapUsedMb:  Math.round(mem.heapUsed  / 1_048_576),
      heapTotalMb: Math.round(mem.heapTotal / 1_048_576),
      rssMb:       Math.round(mem.rss       / 1_048_576),
    };
    payload.queue = { available: false };

    try {
      const queueService = require("./services/queue.service");
      if (queueService.isAvailable) {
        const stats = await Promise.race([
          queueService.getQueueStats(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 1_000)),
        ]);
        payload.queue = { available: true, ...stats };
      }
    } catch { /* Redis may be offline */ }

    try {
      const fse = require("fs-extra");
      const { UPLOAD_DIR, OUTPUT_DIR } = require("./config/constants");
      const [uploadFiles, outputFiles] = await Promise.all([
        fse.readdir(UPLOAD_DIR).then((f) => f.length).catch(() => -1),
        fse.readdir(OUTPUT_DIR).then((f) => f.length).catch(() => -1),
      ]);
      payload.storage = { uploadsPending: uploadFiles, outputsReady: outputFiles };
    } catch { payload.storage = { error: "could not read directories" }; }
  }

  res.json(payload);
});

// ── Keep-alive ping ───────────────────────────────────────────────────────────
app.get("/ping", (_req, res) => res.json({ pong: true, ts: Date.now() }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/convert", converterRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ai",        aiRoutes);
app.use("/api/jobs",      jobsRoutes);
app.use("/api/converters", trendingRoutes);
app.use("/api/payments",      paymentRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/webhooks",      webhookRoutes);
app.use("/api/career",        careerRoutes);
app.use("/api/share",         shareRoutes);
app.use("/api/public",        publicRoutes);
app.use("/api/resume",        resumeRoutes);
app.use("/api/portfolio",     portfolioRoutes);

// ── Error Handlers ────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
