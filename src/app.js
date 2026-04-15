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
const logger = require("./utils/logger");

const app = express();

// ─── Security ─────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow file downloads
  }),
);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:4200",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ─── Core Middleware ──────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ─── HTTP Logging ─────────────────────────────────────────
app.use(
  morgan("combined", {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === "/health",
  }),
);

// ─── Rate Limiting ────────────────────────────────────────
app.use("/api/", globalRateLimiter);

// ─── Static Output Files (generated downloads) ───────────
app.use(
  "/outputs",
  express.static(path.join(__dirname, "..", "outputs"), {
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  }),
);

// ─── Health Check ─────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || "1.0.0",
  });
});

// ─── Routes ───────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/convert", converterRoutes);
app.use("/api/history", historyRoutes);

// ─── Error Handling ───────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
