"use strict";
const express = require("express");
const router = express.Router();
const { getActivityLogs } = require("../controllers/activityLog.controller");
const { requirePermission } = require("../middleware/admin.middleware");

// Mounted at /api/admin/activity-logs by admin.routes.js — protect/restrictTo
// already applied at that parent router level.
router.get("/", requirePermission("activity.view"), getActivityLogs);

module.exports = router;
