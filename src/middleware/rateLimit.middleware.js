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

/** Stricter limiter for auth routes — no bypass; applies to all callers */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
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

/** Strict limiter for password-reset requests — prevents email flooding & token enumeration */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password reset requests. Please try again in an hour.",
  },
});

/** Token-refresh limiter — prevents brute-force against the refresh endpoint */
const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many token refresh requests. Please try again later.",
  },
});

module.exports = {
  globalRateLimiter,
  authRateLimiter,
  conversionRateLimiter,
  passwordResetLimiter,
  refreshRateLimiter,
};
