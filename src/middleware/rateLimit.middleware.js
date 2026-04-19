"use strict";

const rateLimit = require("express-rate-limit");

const windowMs =
  parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000; // 15 min
const max = parseInt(process.env.RATE_LIMIT_MAX, 10) || 500;

/** General API rate limiter */
const globalRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
  },
});

/** Stricter limiter for auth routes — skipped for admin/superadmin tokens */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting if request carries a valid admin token
    try {
      const jwt = require("jsonwebtoken");
      const auth = req.headers.authorization?.split(" ")[1];
      if (!auth) return false;
      const decoded = jwt.verify(auth, process.env.JWT_SECRET);
      return !!decoded?.id; // any authenticated user skips auth rate limit
    } catch { return false; }
  },
  message: {
    success: false,
    message: "Too many login attempts. Please wait 15 minutes.",
  },
});

/** Per-conversion limiter (heavier operations) */
const conversionRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Conversion rate limit reached. Please wait before converting again.",
  },
});

module.exports = { globalRateLimiter, authRateLimiter, conversionRateLimiter };
