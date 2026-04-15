"use strict";
const express = require("express");
const { body } = require("express-validator");
const router = express.Router();

const admin = require("../controllers/admin.controller");
const { protect, restrictTo } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");

// All admin routes require authentication + admin role
router.use(protect);
router.use(restrictTo("admin", "superadmin"));

// ── User Management ──────────────────────────────────────────────────────────
router.get("/users", admin.getUsers);
router.get("/users/:id", admin.getUser);
router.post(
  "/users",
  [
    body("name").trim().notEmpty(),
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 8 }),
    body("role").isIn(["user", "premium", "admin"]).optional(),
  ],
  validate,
  admin.createUser,
);
router.patch("/users/:id", admin.updateUser);
router.delete("/users/:id", admin.deleteUser);
router.post("/users/:id/suspend", admin.suspendUser);
router.post("/users/:id/unsuspend", admin.unsuspendUser);
router.post("/users/:id/ban", admin.banUser);
router.post("/users/:id/unban", admin.unbanUser);
router.post("/users/:id/reset-usage", admin.resetUserUsage);

// ── Analytics ────────────────────────────────────────────────────────────────
router.get("/analytics/overview", admin.getAnalyticsOverview);
router.get("/analytics/tools", admin.getToolStats);
router.get("/analytics/daily", admin.getDailyStats);
router.get("/analytics/subscriptions", admin.getSubscriptionStats);

// ── Queue & Jobs ─────────────────────────────────────────────────────────────
router.get("/queue/stats", admin.getQueueStats);
router.get("/queue/failed", admin.getFailedJobs);
router.post("/queue/jobs/:jobId/retry", admin.retryQueueJob);
router.delete("/queue/jobs/:jobId", admin.removeQueueJob);

// All jobs list
router.get("/jobs", require("../controllers/jobs.controller").getAllJobs);

// ── System Logs ───────────────────────────────────────────────────────────────
router.get("/logs/errors", admin.getErrorLogs);

// ── Plans ─────────────────────────────────────────────────────────────────────
router.get("/plans", admin.getPlans);
router.put("/plans/:id", admin.updatePlan);

module.exports = router;
