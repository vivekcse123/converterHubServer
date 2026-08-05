"use strict";
const ActivityLog = require("../models/ActivityLog");
const { paginated } = require("../utils/response");

// GET /api/admin/activity-logs
const getActivityLogs = async (req, res, next) => {
  try {
    const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const { actorId, action, targetType, targetId, from, to } = req.query;

    const filter = {};
    if (actorId) filter.actorId = actorId;
    if (action) filter.action = action;
    if (targetType) filter.targetType = targetType;
    if (targetId) filter.targetId = targetId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ActivityLog.countDocuments(filter),
    ]);

    paginated(res, logs, total, page, limit);
  } catch (err) {
    next(err);
  }
};

module.exports = { getActivityLogs };
