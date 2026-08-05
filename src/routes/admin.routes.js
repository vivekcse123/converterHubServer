"use strict";
const express = require("express");
const { body } = require("express-validator");
const router = express.Router();

const admin = require("../controllers/admin.controller");
const { protect, restrictTo } = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/admin.middleware");
const { validate } = require("../middleware/validate.middleware");

// All admin routes require authentication + an admin-panel-capable role.
// Fine-grained access within that set is enforced per-route below via
// requirePermission (see config/adminPermissions.js).
router.use(protect);
router.use(restrictTo("admin", "superadmin", "editor", "support", "moderator"));

// ── Current admin's permissions (frontend hydrates its permission set from this) ──
router.get("/me/permissions", admin.getMyPermissions);

// ── User Management ──────────────────────────────────────────────────────────
router.get("/users", requirePermission("users.view"), admin.getUsers);
router.get("/users/:id", requirePermission("users.view"), admin.getUser);
router.post(
  "/users",
  requirePermission("users.edit"),
  [
    body("name").trim().notEmpty(),
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 8 }),
    body("role").isIn(["user", "premium", "admin", "editor", "support", "moderator"]).optional(),
  ],
  validate,
  admin.createUser,
);
router.patch("/users/:id", requirePermission("users.edit"), admin.updateUser);
router.delete("/users/:id", requirePermission("users.delete"), admin.deleteUser);
router.post("/users/:id/suspend", requirePermission("users.moderate"), admin.suspendUser);
router.post("/users/:id/unsuspend", requirePermission("users.moderate"), admin.unsuspendUser);
router.post("/users/:id/ban", requirePermission("users.moderate"), admin.banUser);
router.post("/users/:id/unban", requirePermission("users.moderate"), admin.unbanUser);
router.post("/users/:id/reset-usage", requirePermission("users.moderate"), admin.resetUserUsage);
router.post("/users/:id/grant-pro",   requirePermission("users.subscription.manage"), admin.grantPro);
router.post("/users/:id/remove-pro",  requirePermission("users.subscription.manage"), admin.removePro);
router.post("/users/:id/extend-subscription", requirePermission("users.subscription.manage"), admin.extendSubscription);
router.get("/users/:id/payments",     requirePermission("payments.view"), admin.getUserPayments);

// ── Analytics ────────────────────────────────────────────────────────────────
router.get("/analytics/overview", requirePermission("analytics.view"), admin.getAnalyticsOverview);
router.get("/analytics/tools", requirePermission("analytics.view"), admin.getToolStats);
router.get("/analytics/daily", requirePermission("analytics.view"), admin.getDailyStats);
router.get("/analytics/subscriptions",        requirePermission("analytics.view"), admin.getSubscriptionStats);
router.get("/analytics/subscription-stats",   requirePermission("analytics.view"), admin.getDetailedSubscriptionStats);
router.get("/analytics/revenue",              requirePermission("analytics.view"), admin.getRevenue);
router.get("/analytics/trending",             requirePermission("analytics.view"), admin.getTrendingConverters);

// ── Queue & Jobs (folded into the File Conversions module's "Live Queue" tab) ──
router.get("/queue/stats", requirePermission("conversions.view"), admin.getQueueStats);
router.get("/queue/failed", requirePermission("conversions.view"), admin.getFailedJobs);
router.post("/queue/jobs/:jobId/retry", requirePermission("conversions.manage"), admin.retryQueueJob);
router.delete("/queue/jobs/:jobId", requirePermission("conversions.manage"), admin.removeQueueJob);

// All jobs list
router.get("/jobs", requirePermission("conversions.view"), require("../controllers/jobs.controller").getAllJobs);

// ── File Conversions (History tab) ──────────────────────────────────────────
router.get("/conversions", requirePermission("conversions.view"), admin.getConversions);
router.get("/conversions/:id", requirePermission("conversions.view"), admin.getConversion);

// ── System Logs ───────────────────────────────────────────────────────────────
router.get("/logs/errors", requirePermission("settings.logs.view"), admin.getErrorLogs);

// ── Plans ─────────────────────────────────────────────────────────────────────
router.get("/plans", requirePermission("settings.plans.manage"), admin.getPlans);
router.put("/plans/:id", requirePermission("settings.plans.manage"), admin.updatePlan);

// ── Site branding ────────────────────────────────────────────────────────────
router.get("/settings/site-config", requirePermission("settings.branding.manage"), admin.getSiteConfig);
router.put("/settings/site-config", requirePermission("settings.branding.manage"), admin.updateSiteConfig);

// ── Payments ──────────────────────────────────────────────────────────────────
router.get("/payments", requirePermission("payments.view"), admin.getPayments);
router.get("/payments/:id", requirePermission("payments.view"), admin.getPayment);
router.post("/payments/:id/refund", requirePermission("payments.manage"), admin.refundPayment);

// ── Resume Download Audit Logs ────────────────────────────────────────────────
router.get("/resume-logs", requirePermission("analytics.view"), require("../controllers/resume.controller").getDownloadLogs);

// ── Portfolios ────────────────────────────────────────────────────────────────
router.use("/portfolios", require("./adminPortfolio.routes"));

// ── Activity Logs ────────────────────────────────────────────────────────────
router.use("/activity-logs", require("./activityLog.routes"));

module.exports = router;
