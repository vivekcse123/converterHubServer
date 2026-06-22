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

// ── Response-time header (visible in browser DevTools Network tab) ────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    res.setHeader("X-Response-Time", `${Date.now() - start}ms`);
  });
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
  express.json({ limit })(req, _res, next);
});
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

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

// ── Error Handlers ────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
