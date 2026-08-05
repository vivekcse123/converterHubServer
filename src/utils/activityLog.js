"use strict";
const ActivityLog = require("../models/ActivityLog");
const logger = require("./logger");

/** Fire-and-forget admin-action audit write — must never fail or delay the
 *  admin action itself. Call at the success path of every admin mutation. */
const logActivity = (req, action, targetType, targetId, targetLabel, metadata = {}) => {
  ActivityLog.create({
    actorId: req.user._id,
    actorEmail: req.user.email,
    actorRole: req.user.role,
    action,
    targetType,
    targetId,
    targetLabel,
    metadata,
    ipAddress: req.ip,
  }).catch((err) => logger.error(`activityLog write failed: ${err.message}`));
};

module.exports = { logActivity };
