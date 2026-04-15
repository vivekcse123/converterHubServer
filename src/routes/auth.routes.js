"use strict";
const express = require("express");
const { body } = require("express-validator");
const router  = express.Router();
const { register, login, refresh, logout, logoutAll, getMe, updateProfile, changePassword } = require("../controllers/auth.controller");
const { protect }         = require("../middleware/auth.middleware");
const { validate }        = require("../middleware/validate.middleware");
const { authRateLimiter } = require("../middleware/rateLimit.middleware");

router.post("/register", authRateLimiter,
  [body("name").trim().notEmpty().isLength({ min: 2, max: 50 }),
   body("email").isEmail().normalizeEmail(),
   body("password").isLength({ min: 8 })],
  validate, register);

router.post("/login", authRateLimiter,
  [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
  validate, login);

router.post("/refresh", refresh);
router.post("/logout",     protect, logout);
router.post("/logout-all", protect, logoutAll);

router.get("/me",      protect, getMe);
router.patch("/profile",         protect, updateProfile);
router.patch("/change-password", protect,
  [body("currentPassword").notEmpty(), body("newPassword").isLength({ min: 8 })],
  validate, changePassword);

module.exports = router;
