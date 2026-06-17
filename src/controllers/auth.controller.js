"use strict";
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { success, error } = require("../utils/response");
const { sendWelcomeEmail, sendPasswordResetEmail } = require("../services/email.service");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is not set — refusing to start.");

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || JWT_SECRET + "_refresh";
const JWT_REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || "30d";

const signAccessToken = (id) =>
  jwt.sign({ id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
const signRefreshToken = (id) =>
  jwt.sign({ id }, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES });

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    // Skip the duplicate-check findOne() — let the unique index reject it.
    // This saves one full DB round trip on the happy path.
    let user;
    try {
      user = await User.create({ name, email, password });
    } catch (err) {
      if (err.code === 11000) return error(res, "Email already registered", 409);
      throw err;
    }
    const accessToken = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);
    // Atomic push — avoids serialising and saving the full user document
    await User.findByIdAndUpdate(user._id, {
      $push: { refreshTokens: { token: refreshToken } },
    });
    // Fire-and-forget welcome email — never blocks the response
    sendWelcomeEmail(user);
    success(
      res,
      { user, accessToken, refreshToken },
      "Account created successfully",
      201,
    );
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await user.comparePassword(password)))
      return error(res, "Invalid email or password", 401);
    if (user.isBanned)
      return error(res, "Account banned. Contact support.", 403);
    if (user.isSuspended && user.suspendedUntil > new Date())
      return error(
        res,
        `Account suspended until ${user.suspendedUntil.toISOString()}`,
        403,
      );
    if (!user.isActive)
      return error(res, "Account deactivated. Contact support.", 403);

    const accessToken = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);
    // Atomic push with $slice — keeps the last 5 tokens, no full-doc save needed
    await User.findByIdAndUpdate(user._id, {
      $push: { refreshTokens: { $each: [{ token: refreshToken }], $slice: -5 } },
    });
    // Fire-and-forget metadata — never blocks the login response
    User.findByIdAndUpdate(user._id, {
      $set: { lastLoginAt: new Date(), lastLoginIp: req.ip },
      $inc: { loginCount: 1 },
    }).catch(() => {});

    success(
      res,
      { user, accessToken, refreshToken, token: accessToken },
      "Login successful",
    );
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/refresh
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return error(res, "Refresh token required", 400);
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch {
      return error(res, "Invalid or expired refresh token", 401);
    }

    // Single query: find user AND verify token exists — saves a separate tokenExists check
    const user = await User.findOne({
      _id: decoded.id,
      isActive: true,
      'refreshTokens.token': refreshToken,
    });
    if (!user) return error(res, "Refresh token revoked or account deactivated", 401);

    const newAccessToken = signAccessToken(user._id);
    const newRefreshToken = signRefreshToken(user._id);
    // Rotate: pull old token, push new — two targeted atomic ops, no full-doc save
    await User.findByIdAndUpdate(user._id, {
      $pull: { refreshTokens: { token: refreshToken } },
    });
    await User.findByIdAndUpdate(user._id, {
      $push: { refreshTokens: { $each: [{ token: newRefreshToken }], $slice: -10 } },
    });

    success(res, {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      token: newAccessToken,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/logout
const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (req.user && refreshToken) {
      req.user.refreshTokens = req.user.refreshTokens.filter(
        (t) => t.token !== refreshToken,
      );
      await req.user.save({ validateBeforeSave: false });
    }
    success(res, {}, "Logged out successfully");
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/logout-all
const logoutAll = async (req, res, next) => {
  try {
    req.user.refreshTokens = [];
    await req.user.save({ validateBeforeSave: false });
    success(res, {}, "Logged out from all devices");
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
const getMe = async (req, res) => success(res, { user: req.user });

// PATCH /api/auth/profile
const updateProfile = async (req, res, next) => {
  try {
    const { name, timezone } = req.body;
    const update = {};
    if (name) update.name = name;
    if (timezone) update.timezone = timezone;
    const user = await User.findByIdAndUpdate(req.user._id, update, {
      new: true,
      runValidators: true,
    });
    success(res, { user }, "Profile updated");
  } catch (err) {
    next(err);
  }
};

// PATCH /api/auth/change-password
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select("+password");
    if (!(await user.comparePassword(currentPassword)))
      return error(res, "Current password is incorrect", 400);
    user.password = newPassword;
    user.refreshTokens = []; // Invalidate all sessions
    await user.save();
    success(res, {}, "Password changed. Please log in again.");
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase().trim() });

    // Always return 200 to prevent email enumeration
    if (!user || !user.isActive) {
      return success(res, {}, "If that email is registered, a reset link has been sent.");
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save({ validateBeforeSave: false });

    try {
      await sendPasswordResetEmail(user, rawToken);
    } catch {
      // Clean up token if email fails — don't leave a dangling token
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return error(res, "Failed to send reset email. Please try again later.", 500);
    }

    success(res, {}, "If that email is registered, a reset link has been sent.");
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/reset-password/:token
const resetPassword = async (req, res, next) => {
  try {
    const hashedToken = crypto.createHash("sha256").update(req.params.token).digest("hex");

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) return error(res, "Reset link is invalid or has expired.", 400);

    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.refreshTokens = []; // Invalidate all active sessions
    await user.save();

    success(res, {}, "Password reset successful. Please log in with your new password.");
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
};
