"use strict";
const Portfolio = require("../models/Portfolio");
const { success, error, paginated } = require("../utils/response");
const { logActivity } = require("../utils/activityLog");

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/admin/portfolios
const getPortfolios = async (req, res, next) => {
  try {
    const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const { search, status, featured, isPublic, includeDeleted } = req.query;

    const filter = {};
    if (!includeDeleted) filter.deletedAt = null;
    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ username: re }, { displayName: re } ];
    }
    if (status) filter.status = status;
    if (featured !== undefined) filter.featured = featured === "true";
    if (isPublic !== undefined) filter.isPublic = isPublic === "true";

    const [portfolios, total] = await Promise.all([
      Portfolio.find(filter)
        .select("-draft -published -sections")
        .populate("userId", "name email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Portfolio.countDocuments(filter),
    ]);

    paginated(res, portfolios, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/portfolios/:id
const getPortfolio = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id)
      .populate("userId", "name email")
      .lean();
    if (!portfolio) return error(res, "Portfolio not found", 404);
    success(res, { portfolio });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/portfolios/:id/feature
const featurePortfolio = async (req, res, next) => {
  try {
    const { featured } = req.body;
    const portfolio = await Portfolio.findByIdAndUpdate(
      req.params.id, { featured: !!featured }, { new: true }
    ).select("username featured");
    if (!portfolio) return error(res, "Portfolio not found", 404);
    logActivity(req, featured ? "portfolio.feature" : "portfolio.unfeature", "Portfolio", portfolio._id, portfolio.username);
    success(res, { portfolio });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/portfolios/:id/hide
const hidePortfolio = async (req, res, next) => {
  try {
    const { isHidden, reason } = req.body;
    const portfolio = await Portfolio.findByIdAndUpdate(
      req.params.id,
      { isHidden: !!isHidden, hiddenReason: isHidden ? (reason || "") : "" },
      { new: true }
    ).select("username isHidden hiddenReason");
    if (!portfolio) return error(res, "Portfolio not found", 404);
    logActivity(req, isHidden ? "portfolio.hide" : "portfolio.unhide", "Portfolio", portfolio._id, portfolio.username, { reason });
    success(res, { portfolio });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/portfolios/:id  (soft delete)
const deletePortfolio = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findByIdAndUpdate(
      req.params.id, { deletedAt: new Date() }, { new: true }
    ).select("username");
    if (!portfolio) return error(res, "Portfolio not found", 404);
    logActivity(req, "portfolio.delete", "Portfolio", portfolio._id, portfolio.username);
    success(res, { message: "Portfolio deleted" });
  } catch (err) {
    next(err);
  }
};

module.exports = { getPortfolios, getPortfolio, featurePortfolio, hidePortfolio, deletePortfolio };
