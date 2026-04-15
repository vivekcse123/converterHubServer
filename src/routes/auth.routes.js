"use strict";

const express = require("express");
const { body } = require("express-validator");
const router = express.Router();

const { register, login, getMe } = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { authRateLimiter } = require("../middleware/rateLimit.middleware");

router.post(
  "/register",
  authRateLimiter,
  [
    body("name")
      .trim()
      .notEmpty()
      .isLength({ min: 2, max: 50 })
      .withMessage("Name must be 2–50 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("password")
      .isLength({ min: 8 })
      .withMessage("Password must be at least 8 characters"),
  ],
  validate,
  register,
);

router.post(
  "/login",
  authRateLimiter,
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  validate,
  login,
);

router.get("/me", protect, getMe);

module.exports = router;
