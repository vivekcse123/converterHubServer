"use strict";

const ConversionHistory = require("../models/ConversionHistory");
const { success, error, paginated } = require("../utils/response");

// GET /api/history
const getHistory = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      ConversionHistory.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ConversionHistory.countDocuments({ user: req.user._id }),
    ]);

    paginated(res, records, total, page, limit);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/history/:id
const deleteHistory = async (req, res, next) => {
  try {
    const record = await ConversionHistory.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!record) {
      return error(res, "History record not found", 404);
    }

    success(res, {}, "History record deleted");
  } catch (err) {
    next(err);
  }
};

module.exports = { getHistory, deleteHistory };
