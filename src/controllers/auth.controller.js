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
    const existing = await User.findOne({ email });
    if (existing) return error(res, "Email already registered", 409);
    const user = await User.create({ name, email, password });
    const accessToken = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);
    user.refreshTokens.push({ token: refreshToken });
    await user.save({ validateBeforeSave: false });
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

    user.lastLoginAt = new Date();
    user.lastLoginIp = req.ip;
    user.loginCount = (user.loginCount || 0) + 1;
    const accessToken = signAccessToken(user._id);
    const refreshToken = signRefreshToken(user._id);
    // Keep max 5 refresh tokens per user
    if (user.refreshTokens.length >= 5) user.refreshTokens.shift();
    user.refreshTokens.push({ token: refreshToken });
    await user.save({ validateBeforeSave: false });

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

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive)
      return error(res, "User not found or deactivated", 401);
    const tokenExists = user.refreshTokens.some(
      (t) => t.token === refreshToken,
    );
    if (!tokenExists) return error(res, "Refresh token revoked", 401);

    const newAccessToken = signAccessToken(user._id);
    const newRefreshToken = signRefreshToken(user._id);
    // Rotate refresh token
    user.refreshTokens = user.refreshTokens.filter(
      (t) => t.token !== refreshToken,
    );
    user.refreshTokens.push({ token: newRefreshToken });
    await user.save({ validateBeforeSave: false });

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
