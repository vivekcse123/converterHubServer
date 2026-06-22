"use strict";

const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { error } = require("../utils/response");
const userCache = require("../utils/userCache");

async function _fetchUser(id) {
  let user = userCache.get(id);
  if (user) return user;
  // .lean() returns a plain JS object — ~3× faster than a full Mongoose document
  // for read-only use. Downstream code reads properties only; no .save() on req.user.
  user = await User.findById(id).select("-password -refreshTokens").lean();
  if (user) userCache.set(id, user);
  return user;
}

/**
 * Protect routes — verifies the Bearer JWT and attaches req.user.
 */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return error(res, "No token provided", 401);
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await _fetchUser(decoded.id);
    if (!user || !user.isActive) {
      return error(res, "User not found or deactivated", 401);
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return error(res, "Token expired", 401);
    }
    if (err.name === "JsonWebTokenError") {
      return error(res, "Invalid token", 401);
    }
    next(err);
  }
};

/**
 * Optional auth — attaches req.user if token present but never blocks.
 */
const optionalAuth = async (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await _fetchUser(decoded.id);
    }
  } catch {
    // Silently ignore invalid tokens for optional auth
  }
  next();
};

/**
 * Restrict access to specific roles.
 */
const restrictTo =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return error(
        res,
        "You do not have permission to perform this action",
        403,
      );
    }
    next();
  };

module.exports = { protect, optionalAuth, restrictTo };
