"use strict";
const express = require("express");
const { body } = require("express-validator");
const router = express.Router();
const {
  register,
  login,
  googleLogin,
  refresh,
  logout,
  logoutAll,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
} = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { authRateLimiter, passwordResetLimiter, refreshRateLimiter } = require("../middleware/rateLimit.middleware");

router.post(
  "/register",
  authRateLimiter,
  [
    body("name").trim().notEmpty().isLength({ min: 2, max: 50 }),
    // Use toLowerCase only — normalizeEmail() strips Gmail dots and breaks
    // round-trip lookups for addresses like john.doe@gmail.com
    body("email").isEmail().customSanitizer((v) => (typeof v === "string" ? v.toLowerCase().trim() : v)),
    body("password").isLength({ min: 8 }),
  ],
  validate,
  register,
);

router.post(
  "/login",
  authRateLimiter,
  [
    body("email").isEmail().customSanitizer((v) => (typeof v === "string" ? v.toLowerCase().trim() : v)),
    body("password").notEmpty(),
  ],
  validate,
  login,
);

router.post(
  "/google",
  authRateLimiter,
  [body("accessToken").notEmpty()],
  validate,
  googleLogin,
);

router.post("/refresh", refreshRateLimiter, refresh);
router.post("/logout", protect, logout);
router.post("/logout-all", protect, logoutAll);
//wdwnfk
router.get("/me", protect, getMe);
router.patch("/profile", protect, updateProfile);
router.patch(
  "/change-password",
  protect,
  [
    body("currentPassword").notEmpty(),
    body("newPassword").isLength({ min: 8 }),
  ],
  validate,
  changePassword,
);

router.post(
  "/forgot-password",
  passwordResetLimiter,
  [body("email").isEmail().customSanitizer((v) => (typeof v === "string" ? v.toLowerCase().trim() : v))],
  validate,
  forgotPassword,
);

router.post(
  "/reset-password/:token",
  passwordResetLimiter,
  [body("password").isLength({ min: 8 })],
  validate,
  resetPassword,
);

module.exports = router;
