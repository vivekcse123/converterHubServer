"use strict";
const User = require("../models/User");
const ConversionHistory = require("../models/ConversionHistory");
const Job = require("../models/Job");
const Plan = require("../models/Plan");
const Payment = require("../models/Payment");
const { success, error, paginated } = require("../utils/response");
const logger = require("../utils/logger");
const queueService = require("../services/queue.service");

// Fields that must never appear in API responses even when using .lean()
const SENSITIVE_FIELDS = ["password", "refreshTokens", "passwordResetToken", "passwordResetExpires"];
const stripSensitive = (user) => {
  if (!user) return user;
  const u = { ...user };
  SENSITIVE_FIELDS.forEach((f) => delete u[f]);
  return u;
};

// Sanitise a search string: enforce string type, escape regex metacharacters,
// limit length to prevent ReDoS.
const sanitizeSearch = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  return raw.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// ── User Management ──────────────────────────────────────────────────────────

// GET /api/admin/users
const getUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const search = sanitizeSearch(req.query.search);
    const role = req.query.role;
    const plan = req.query.plan;
    const status = req.query.status;

    const filter = {};
    if (search)
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    if (role) filter.role = role;
    if (plan) filter["subscription.plan"] = plan;
    if (status === "banned") filter.isBanned = true;
    if (status === "suspended") filter.isSuspended = true;
    if (status === "inactive") filter.isActive = false;

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    paginated(res, users.map(stripSensitive), total, page, limit);
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/users/:id
const getUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).lean();
    if (!user) return error(res, "User not found", 404);
    // Include their conversion stats
    const [totalConversions, recentActivity] = await Promise.all([
      ConversionHistory.countDocuments({ user: user._id }),
      ConversionHistory.find({ user: user._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);
    success(res, { user: stripSensitive(user), totalConversions, recentActivity });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/users
const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role = "user", plan = "free" } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return error(res, "Email already registered", 409);
    const user = await User.create({
      name,
      email,
      password,
      role,
      "subscription.plan": plan,
    });
    success(res, { user }, "User created", 201);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/admin/users/:id
const updateUser = async (req, res, next) => {
  try {
    const { name, email, role, plan, isActive, adminNotes } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (email !== undefined) update.email = email;
    // Superadmin role can only be assigned by superadmins, not regular admins
    if (role !== undefined) {
      const allowedRoles = req.user.role === "superadmin"
        ? ["user", "premium", "admin", "superadmin"]
        : ["user", "premium", "admin"];
      if (!allowedRoles.includes(role)) {
        return error(res, `You cannot assign the role '${role}'.`, 403);
      }
      update.role = role;
    }
    if (plan !== undefined) update["subscription.plan"] = plan;
    if (isActive !== undefined) update.isActive = isActive;
    if (adminNotes !== undefined) update.adminNotes = adminNotes;

    const user = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });
    if (!user) return error(res, "User not found", 404);
    success(res, { user }, "User updated");
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/users/:id
const deleteUser = async (req, res, next) => {
  try {
    if (req.params.id === String(req.user._id))
      return error(res, "You cannot delete your own account", 400);
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return error(res, "User not found", 404);
    // Cascade delete their history
    await ConversionHistory.deleteMany({ user: req.params.id });
    success(res, {}, "User deleted");
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/users/:id/suspend
const suspendUser = async (req, res, next) => {
  try {
    const { reason, hours = 24 } = req.body;
    const suspendedUntil = new Date(Date.now() + hours * 3600_000);
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        isSuspended: true,
        suspendedUntil,
        banReason: reason || "Suspended by admin",
      },
      { new: true },
    );
    if (!user) return error(res, "User not found", 404);
    success(res, { user }, `User suspended for ${hours} hours`);
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/users/:id/unsuspend
const unsuspendUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        isSuspended: false,
        suspendedUntil: null,
        banReason: null,
      },
      { new: true },
    );
    if (!user) return error(res, "User not found", 404);
    success(res, { user }, "User unsuspended");
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/users/:id/ban
const banUser = async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (req.params.id === String(req.user._id))
      return error(res, "Cannot ban yourself", 400);
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        isBanned: true,
        isActive: false,
        banReason: reason || "Banned by admin",
      },
      { new: true },
    );
    if (!user) return error(res, "User not found", 404);
    success(res, { user }, "User banned");
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/users/:id/unban
const unbanUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        isBanned: false,
        isActive: true,
        banReason: null,
      },
      { new: true },
    );
    if (!user) return error(res, "User not found", 404);
    success(res, { user }, "User unbanned");
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/users/:id/reset-usage
const resetUserUsage = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        "usage.conversionsToday": 0,
        "usage.aiRequestsToday": 0,
        "usage.lastUsageReset": new Date(),
      },
      { new: true },
    );
    if (!user) return error(res, "User not found", 404);
    success(res, { user }, "Usage reset");
  } catch (err) {
    next(err);
  }
};

// ── Analytics ────────────────────────────────────────────────────────────────

// GET /api/admin/analytics/overview
const getAnalyticsOverview = async (req, res, next) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week = new Date(today - 7 * 86_400_000);
    const month = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      newUsersToday,
      newUsersWeek,
      newUsersMonth,
      totalConversions,
      todayConversions,
      weekConversions,
      monthConversions,
      failedConversions,
      activeUsers,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: today } }),
      User.countDocuments({ createdAt: { $gte: week } }),
      User.countDocuments({ createdAt: { $gte: month } }),
      ConversionHistory.countDocuments(),
      ConversionHistory.countDocuments({ createdAt: { $gte: today } }),
      ConversionHistory.countDocuments({ createdAt: { $gte: week } }),
      ConversionHistory.countDocuments({ createdAt: { $gte: month } }),
      ConversionHistory.countDocuments({ status: "failed" }),
      User.countDocuments({ lastLoginAt: { $gte: week } }),
    ]);

    success(res, {
      users: {
        total: totalUsers,
        today: newUsersToday,
        week: newUsersWeek,
        month: newUsersMonth,
        active: activeUsers,
      },
      conversions: {
        total: totalConversions,
        today: todayConversions,
        week: weekConversions,
        month: monthConversions,
        failed: failedConversions,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/analytics/tools
const getToolStats = async (req, res, next) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const since = new Date(Date.now() - days * 86_400_000);
    const stats = await ConversionHistory.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$tool",
          count: { $sum: 1 },
          failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
          avgTime: { $avg: "$processingTimeMs" },
        },
      },
      { $sort: { count: -1 } },
    ]);
    success(res, { stats, days });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/analytics/daily
const getDailyStats = async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 365);
    const since = new Date(Date.now() - days * 86_400_000);
    const [convStats, userStats] = await Promise.all([
      ConversionHistory.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            conversions: { $sum: 1 },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            newUsers: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);
    success(res, { conversions: convStats, users: userStats });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/analytics/subscriptions
const getSubscriptionStats = async (req, res, next) => {
  try {
    const stats = await User.aggregate([
      { $group: { _id: "$subscription.plan", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    success(res, { stats });
  } catch (err) {
    next(err);
  }
};

// ── Queue / Job Monitoring ────────────────────────────────────────────────────

// GET /api/admin/queue/stats
const getQueueStats = async (req, res, next) => {
  try {
    const stats = await queueService.getQueueStats();
    success(res, { stats, available: queueService.isAvailable });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/queue/failed
const getFailedJobs = async (req, res, next) => {
  try {
    const jobs = await queueService.getFailedJobs(0, 49);
    const mapped = jobs.map((j) => ({
      id: j.id,
      name: j.name,
      data: j.data,
      failedReason: j.failedReason,
      attemptsMade: j.attemptsMade,
      timestamp: j.timestamp,
    }));
    success(res, { jobs: mapped });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/queue/jobs/:jobId/retry
const retryQueueJob = async (req, res, next) => {
  try {
    await queueService.retryJob(req.params.jobId);
    success(res, {}, "Job queued for retry");
  } catch (err) {
    next(err);
  }
};

// DELETE /api/admin/queue/jobs/:jobId
const removeQueueJob = async (req, res, next) => {
  try {
    await queueService.removeJob(req.params.jobId);
    success(res, {}, "Job removed from queue");
  } catch (err) {
    next(err);
  }
};

// ── System / Error Logs ───────────────────────────────────────────────────────

// GET /api/admin/logs/errors
const getErrorLogs = async (req, res, next) => {
  try {
    const fse = require("fs-extra");
    const path = require("path");
    const logPath = path.join(__dirname, "../../logs/error.log");
    if (!(await fse.pathExists(logPath))) return success(res, { lines: [] });
    const content = await fse.readFile(logPath, "utf8");
    const lines = content.split("\n").filter(Boolean).reverse().slice(0, 200);
    success(res, { lines });
  } catch (err) {
    next(err);
  }
};

// ── Plans Management ──────────────────────────────────────────────────────────

// GET /api/admin/plans
const getPlans = async (req, res, next) => {
  try {
    const plans = await Plan.find().sort({ sortOrder: 1 });
    success(res, { plans });
  } catch (err) {
    next(err);
  }
};

// PUT /api/admin/plans/:id
const updatePlan = async (req, res, next) => {
  try {
    const { name, price, features, isActive, sortOrder, description } = req.body;
    const allowedUpdate = {};
    if (name        !== undefined) allowedUpdate.name        = name;
    if (price       !== undefined) allowedUpdate.price       = price;
    if (features    !== undefined) allowedUpdate.features    = features;
    if (isActive    !== undefined) allowedUpdate.isActive    = isActive;
    if (sortOrder   !== undefined) allowedUpdate.sortOrder   = sortOrder;
    if (description !== undefined) allowedUpdate.description = description;

    const plan = await Plan.findOneAndUpdate({ id: req.params.id }, allowedUpdate, {
      new: true,
      upsert: true,
      runValidators: true,
    });
    success(res, { plan }, "Plan updated");
  } catch (err) {
    next(err);
  }
};

// ── Subscription Management (Admin) ──────────────────────────────────────────

// POST /api/admin/users/:id/grant-pro
const grantPro = async (req, res, next) => {
  try {
    const { plan = "monthly", expiryDate, notes } = req.body;
    const validPlans = ["monthly", "yearly", "lifetime"];
    if (!validPlans.includes(plan)) return error(res, "Invalid plan type", 400);

    let periodEnd;
    if (plan === "lifetime") {
      periodEnd = null; // Lifetime never expires
    } else if (expiryDate) {
      periodEnd = new Date(expiryDate);
    } else {
      const days = plan === "yearly" ? 365 : 30;
      periodEnd = new Date(Date.now() + days * 86_400_000);
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        "subscription.plan":               plan,
        "subscription.status":             "active",
        "subscription.currentPeriodStart": new Date(),
        "subscription.currentPeriodEnd":   periodEnd,
        "subscription.cancelAtPeriodEnd":  false,
        "subscription.grantedByAdmin":     true,
        "subscription.adminNotes":         notes || null,
        "subscription.adminGrantedAt":     new Date(),
        "subscription.adminGrantedBy":     req.user._id,
      },
      { new: true },
    );
    if (!user) return error(res, "User not found", 404);
    logger.info(`Admin ${req.user.email} granted ${plan} pro to ${user.email}`);
    success(res, { user: stripSensitive(user) }, "Pro access granted");
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/users/:id/remove-pro
const removePro = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        "subscription.plan":   "free",
        "subscription.status": "cancelled",
        "subscription.currentPeriodEnd": null,
        "subscription.grantedByAdmin":   false,
      },
      { new: true },
    );
    if (!user) return error(res, "User not found", 404);
    logger.info(`Admin ${req.user.email} removed pro from ${user.email}`);
    success(res, { user: stripSensitive(user) }, "Pro access removed");
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/users/:id/extend-subscription
const extendSubscription = async (req, res, next) => {
  try {
    const { days = 0, months = 0, reason } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return error(res, "User not found", 404);

    const base = user.subscription?.currentPeriodEnd
      ? new Date(user.subscription.currentPeriodEnd)
      : new Date();

    const newEnd = new Date(base);
    newEnd.setDate(newEnd.getDate() + Number(days));
    newEnd.setMonth(newEnd.getMonth() + Number(months));

    user.subscription.currentPeriodEnd = newEnd;
    user.subscription.status = "active";
    await user.save();

    logger.info(`Admin ${req.user.email} extended subscription for ${user.email} to ${newEnd.toISOString()}`);
    success(res, { user: stripSensitive(user.toObject()), newExpiry: newEnd }, "Subscription extended");
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/analytics/subscription-stats
const getDetailedSubscriptionStats = async (req, res, next) => {
  try {
    const now = new Date();
    const in7Days = new Date(Date.now() + 7 * 86_400_000);

    const [
      totalFree, totalMonthly, totalYearly, totalActive, totalExpired,
      totalCancelled, expiringSoon, adminGranted, totalSuspended, totalBanned,
    ] = await Promise.all([
      User.countDocuments({ "subscription.plan": "free" }),
      User.countDocuments({ "subscription.plan": "monthly", "subscription.status": "active" }),
      User.countDocuments({ "subscription.plan": "yearly",  "subscription.status": "active" }),
      User.countDocuments({ "subscription.status": "active" }),
      User.countDocuments({ "subscription.status": { $in: ["expired","past_due"] } }),
      User.countDocuments({ "subscription.status": "cancelled" }),
      User.countDocuments({ "subscription.status": "active", "subscription.currentPeriodEnd": { $lte: in7Days, $gte: now } }),
      User.countDocuments({ "subscription.grantedByAdmin": true }),
      User.countDocuments({ isSuspended: true }),
      User.countDocuments({ isBanned: true }),
    ]);

    success(res, {
      totalFree, totalMonthly, totalYearly, totalActive,
      totalExpired, totalCancelled, expiringSoon, adminGranted,
      totalSuspended, totalBanned,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/analytics/revenue
const getRevenue = async (req, res, next) => {
  try {
    const now = new Date();
    const todayStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart   = new Date(now.getFullYear(), 0, 1);

    const [todayRev, monthRev, yearRev, totalRev, monthlyCount, yearlyCount] = await Promise.all([
      Payment.aggregate([{ $match: { status: "captured", createdAt: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      Payment.aggregate([{ $match: { status: "captured", createdAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      Payment.aggregate([{ $match: { status: "captured", createdAt: { $gte: yearStart } } },  { $group: { _id: null, total: { $sum: "$amount" } } }]),
      Payment.aggregate([{ $match: { status: "captured" } }, { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }]),
      Payment.countDocuments({ plan: "monthly", status: "captured" }),
      Payment.countDocuments({ plan: "yearly",  status: "captured" }),
    ]);

    const toRupees = (agg) => ((agg[0]?.total ?? 0) / 100).toFixed(2);

    success(res, {
      today:          toRupees(todayRev),
      thisMonth:      toRupees(monthRev),
      thisYear:       toRupees(yearRev),
      total:          toRupees(totalRev),
      totalPayments:  totalRev[0]?.count ?? 0,
      monthlyPayments: monthlyCount,
      yearlyPayments:  yearlyCount,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/users/:id/payments
const getUserPayments = async (req, res, next) => {
  try {
    const payments = await Payment.find({ userId: req.params.id }).sort({ createdAt: -1 }).lean();
    success(res, { payments });
  } catch (err) {
    next(err);
  }
};

// ── Trending Converters (public-facing, called from frontend) ─────────────────

// GET /api/converters/trending?limit=10&days=7
const getTrendingConverters = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const days = Math.min(parseInt(req.query.days, 10) || 7, 90);
    const since = new Date(Date.now() - days * 86_400_000);

    const trending = await ConversionHistory.aggregate([
      { $match: { createdAt: { $gte: since }, status: "completed" } },
      {
        $group: {
          _id: "$tool",
          count: { $sum: 1 },
          lastUsed: { $max: "$createdAt" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          tool: "$_id",
          count: 1,
          lastUsed: 1,
        },
      },
    ]);

    success(res, { trending, days });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  suspendUser,
  unsuspendUser,
  banUser,
  unbanUser,
  resetUserUsage,
  grantPro,
  removePro,
  extendSubscription,
  getDetailedSubscriptionStats,
  getRevenue,
  getUserPayments,
  getAnalyticsOverview,
  getToolStats,
  getDailyStats,
  getSubscriptionStats,
  getQueueStats,
  getFailedJobs,
  retryQueueJob,
  removeQueueJob,
  getErrorLogs,
  getPlans,
  updatePlan,
  getTrendingConverters,
};
