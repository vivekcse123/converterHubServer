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
const jobsRoutes = require("./routes/jobs.routes");
const trendingRoutes = require("./routes/trending.routes");
const logger = require("./utils/logger");

const app = express();

// ── Security ─────────────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
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

// Fall back to hardcoded list when env var is absent (local dev)
const corsOrigins = allowedOrigins.length
  ? allowedOrigins
  : ["http://localhost:4200", "https://converter-hub-eight.vercel.app"];

app.use(
  cors({
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

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

// ── Static Files ──────────────────────────────────────────────────────────────
app.use(
  "/outputs",
  express.static(path.join(__dirname, "..", "outputs"), {
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
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
app.use("/api/jobs", jobsRoutes);
app.use("/api/converters", trendingRoutes);

// ── Error Handlers ────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
