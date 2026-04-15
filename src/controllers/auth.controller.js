"use strict";

const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { success, error } = require("../utils/response");

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return error(res, "Email already registered", 409);
    }

    const user = await User.create({ name, email, password });
    const token = signToken(user._id);

    success(res, { user, token }, "Account created successfully", 201);
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return error(res, "Invalid email or password", 401);
    }

    if (!user.isActive) {
      return error(res, "Account deactivated. Contact support.", 403);
    }

    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signToken(user._id);
    success(res, { user, token }, "Login successful");
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  success(res, { user: req.user });
};

module.exports = { register, login, getMe };
