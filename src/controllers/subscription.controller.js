"use strict";
const crypto  = require("crypto");
const User    = require("../models/User");
const Payment = require("../models/Payment");
const { getRazorpay } = require("../config/razorpay");
const { success, error } = require("../utils/response");
const logger = require("../utils/logger");

const PLANS = {
  monthly: { paise: 900,  label: "Pro Monthly" },
  yearly:  { paise: 9900, label: "Pro Yearly"  },
};

// POST /api/subscriptions/create  { plan: 'monthly' | 'yearly' }
const createSubscription = async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!["monthly", "yearly"].includes(plan)) {
      return error(res, "Invalid plan. Choose monthly or yearly.", 400);
    }

    const planId = plan === "monthly"
      ? process.env.RAZORPAY_PLAN_MONTHLY
      : process.env.RAZORPAY_PLAN_YEARLY;

    if (!planId) {
      return error(res, "Subscription plans not configured. Please run setup-razorpay-plans script.", 500);
    }

    const rzp = getRazorpay();

    // If user already has an active subscription, cancel it first
    const existingSub = req.user.subscription?.razorpaySubscriptionId;
    if (existingSub && req.user.subscription?.status === "active") {
      try {
        await rzp.subscriptions.cancel(existingSub, { cancel_at_cycle_end: false });
      } catch (e) {
        logger.warn(`Could not cancel existing subscription ${existingSub}: ${e.message}`);
      }
    }

    const subscription = await rzp.subscriptions.create({
      plan_id:        planId,
      total_count:    plan === "monthly" ? 120 : 10, // 10 years or 10 year renewals
      quantity:       1,
      customer_notify: 1,
      notes: {
        userId: req.user._id.toString(),
        plan,
      },
    });

    logger.info(`Subscription created: ${subscription.id} for user ${req.user._id} plan=${plan}`);

    success(res, {
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan,
      amount: PLANS[plan].paise,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/subscriptions/verify
const verifySubscription = async (req, res, next) => {
  try {
    const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature, plan } = req.body;

    if (!razorpay_subscription_id || !razorpay_payment_id || !razorpay_signature || !plan) {
      return error(res, "Missing required fields.", 400);
    }

    // Verify HMAC signature
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      logger.warn(`Subscription signature mismatch for ${razorpay_subscription_id}`);
      return error(res, "Payment verification failed — invalid signature.", 400);
    }

    // Fetch subscription details from Razorpay for accurate dates
    const rzp = getRazorpay();
    const rzpSub = await rzp.subscriptions.fetch(razorpay_subscription_id);

    const now   = new Date();
    const start = new Date(rzpSub.current_start * 1000 || now);
    const end   = plan === "monthly"
      ? new Date(now.setMonth(now.getMonth() + 1))
      : new Date(now.setFullYear(now.getFullYear() + 1));

    // Update user subscription
    await User.findByIdAndUpdate(req.user._id, {
      "subscription.plan":                   plan,
      "subscription.status":                 "active",
      "subscription.razorpaySubscriptionId": razorpay_subscription_id,
      "subscription.currentPeriodStart":     start,
      "subscription.currentPeriodEnd":       new Date(rzpSub.current_end * 1000 || end),
      "subscription.cancelAtPeriodEnd":      false,
    });

    // Record payment
    await Payment.create({
      userId:                 req.user._id,
      amount:                 PLANS[plan].paise,
      plan,
      status:                 "captured",
      razorpayPaymentId:      razorpay_payment_id,
      razorpaySubscriptionId: razorpay_subscription_id,
      billingCycle:           rzpSub.paid_count || 1,
    });

    logger.info(`Subscription verified: ${razorpay_subscription_id} user=${req.user._id}`);
    success(res, { plan, status: "active" }, "Subscription activated! Welcome to Pro 🎉");
  } catch (err) {
    next(err);
  }
};

// POST /api/subscriptions/cancel
const cancelSubscription = async (req, res, next) => {
  try {
    const sub = req.user.subscription;
    if (!sub?.razorpaySubscriptionId || sub.status !== "active") {
      return error(res, "No active subscription found.", 400);
    }

    const rzp = getRazorpay();
    await rzp.subscriptions.cancel(sub.razorpaySubscriptionId, { cancel_at_cycle_end: true });

    await User.findByIdAndUpdate(req.user._id, {
      "subscription.cancelAtPeriodEnd": true,
    });

    success(res, {}, "Subscription will be cancelled at end of current billing period.");
  } catch (err) {
    next(err);
  }
};

// GET /api/subscriptions/status
const getStatus = (req, res) => {
  const sub = req.user.subscription ?? {};
  const isPro = sub.status === "active" && ["monthly", "yearly"].includes(sub.plan);
  success(res, {
    isPro,
    plan:               sub.plan ?? "free",
    status:             sub.status ?? "free",
    currentPeriodEnd:   sub.currentPeriodEnd ?? null,
    cancelAtPeriodEnd:  sub.cancelAtPeriodEnd ?? false,
    resumeCount:        sub.resumeCount ?? 0,
    totalDownloads:     sub.totalDownloads ?? 0,
  });
};

// GET /api/subscriptions/payments
const getPaymentHistory = async (req, res, next) => {
  try {
    const payments = await Payment.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(24)
      .lean();

    success(res, { payments });
  } catch (err) {
    next(err);
  }
};

// POST /api/subscriptions/track-download  (increment download counter)
const trackDownload = async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, {
    $inc: { "subscription.totalDownloads": 1 },
  });
  success(res, {});
};

// POST /api/subscriptions/sync-resumes  { count: number }
const syncResumeCount = async (req, res) => {
  const count = Math.max(0, parseInt(req.body.count) || 0);
  await User.findByIdAndUpdate(req.user._id, { "subscription.resumeCount": count });
  success(res, {});
};

module.exports = {
  createSubscription,
  verifySubscription,
  cancelSubscription,
  getStatus,
  getPaymentHistory,
  trackDownload,
  syncResumeCount,
};
