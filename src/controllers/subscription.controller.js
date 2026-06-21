"use strict";
const crypto  = require("crypto");
const User    = require("../models/User");
const Payment = require("../models/Payment");
const { getRazorpay } = require("../config/razorpay");
const { success, error } = require("../utils/response");
const logger = require("../utils/logger");

const PLANS = {
  monthly:  { paise: 9900,   label: "Pro Monthly"  },
  yearly:   { paise: 69900,  label: "Pro Yearly"   },
  lifetime: { paise: 149900, label: "Pro Lifetime" },
};

// POST /api/subscriptions/create  { plan: 'monthly' | 'yearly' }
const createSubscription = async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!["monthly", "yearly"].includes(plan)) {
      return error(res, "Invalid plan. Choose monthly or yearly.", 400);
    }

    const existing = req.user.subscription ?? {};
    const isLifetimeActive = existing.status === "active" && existing.plan === "lifetime";
    const isYearlyActive   = existing.status === "active" && existing.plan === "yearly";
    const isMonthlyActive  = existing.status === "active" && existing.plan === "monthly";

    // Hierarchy enforcement
    if (isLifetimeActive) {
      return error(res, "You already have a Lifetime plan. No upgrade needed.", 400);
    }
    if (isYearlyActive) {
      return error(res, "You already have an active Yearly plan. Upgrade to Lifetime at the pricing page.", 400);
    }
    if (isMonthlyActive && plan === "monthly") {
      return error(res, "You already have an active Monthly plan.", 400);
    }

    const isUpgrade = isMonthlyActive && plan === "yearly";

    const planId = plan === "monthly"
      ? process.env.RAZORPAY_PLAN_MONTHLY
      : process.env.RAZORPAY_PLAN_YEARLY;

    if (!planId) {
      return error(res, "Subscription plans not configured. Please run setup-razorpay-plans script.", 500);
    }

    const rzp = getRazorpay();

    // Cancel existing subscription when upgrading monthly → yearly or replacing
    const existingRzpId = existing.razorpaySubscriptionId;
    if (existingRzpId && existing.status === "active") {
      try {
        await rzp.subscriptions.cancel(existingRzpId, { cancel_at_cycle_end: false });
        if (isUpgrade) {
          logger.info(`Cancelled monthly sub ${existingRzpId} for yearly upgrade (user ${req.user._id})`);
        }
      } catch (e) {
        logger.warn(`Could not cancel existing subscription ${existingRzpId}: ${e.message}`);
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
  const isLifetimeActive = sub.status === "active" && sub.plan === "lifetime";
  const isYearlyActive   = sub.status === "active" && sub.plan === "yearly";
  const isMonthlyActive  = sub.status === "active" && sub.plan === "monthly";
  const isPro = isLifetimeActive || isYearlyActive || isMonthlyActive;

  let daysRemaining = 0;
  if (isLifetimeActive) {
    daysRemaining = -1; // sentinel: never expires
  } else if (sub.currentPeriodEnd) {
    daysRemaining = Math.max(0, Math.ceil((new Date(sub.currentPeriodEnd) - Date.now()) / 86_400_000));
  }

  success(res, {
    isPro,
    isPremium:          isPro,
    plan:               sub.plan ?? "free",
    status:             sub.status ?? "free",
    startedAt:          sub.currentPeriodStart ?? null,
    currentPeriodEnd:   sub.currentPeriodEnd ?? null,
    cancelAtPeriodEnd:  sub.cancelAtPeriodEnd ?? false,
    daysRemaining,
    resumeCount:        sub.resumeCount ?? 0,
    totalDownloads:     sub.totalDownloads ?? 0,
    canPurchaseMonthly:  !isPro,
    canPurchaseYearly:   !isYearlyActive && !isLifetimeActive,
    canPurchaseLifetime: !isLifetimeActive,
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

// POST /api/subscriptions/create-lifetime-order
const createLifetimeOrder = async (req, res, next) => {
  try {
    const sub = req.user.subscription ?? {};
    if (sub.status === "active" && sub.plan === "lifetime") {
      return error(res, "You already have a Lifetime plan.", 400);
    }

    const rzp = getRazorpay();
    const order = await rzp.orders.create({
      amount:   PLANS.lifetime.paise,
      currency: "INR",
      receipt:  `lifetime_${req.user._id}_${Date.now()}`,
      notes:    { userId: req.user._id.toString(), plan: "lifetime" },
    });

    logger.info(`Lifetime order created: ${order.id} for user ${req.user._id}`);
    success(res, { orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    next(err);
  }
};

// POST /api/subscriptions/verify-lifetime
const verifyLifetimePayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return error(res, "Missing required fields.", 400);
    }

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      logger.warn(`Lifetime payment signature mismatch for order ${razorpay_order_id}`);
      return error(res, "Payment verification failed — invalid signature.", 400);
    }

    // Cancel any active Razorpay subscription (upgrading from monthly/yearly)
    const existingSub = req.user.subscription ?? {};
    if (existingSub.razorpaySubscriptionId && existingSub.status === "active") {
      const rzp = getRazorpay();
      try {
        await rzp.subscriptions.cancel(existingSub.razorpaySubscriptionId, { cancel_at_cycle_end: false });
      } catch (e) {
        logger.warn(`Could not cancel existing subscription ${existingSub.razorpaySubscriptionId}: ${e.message}`);
      }
    }

    await User.findByIdAndUpdate(req.user._id, {
      "subscription.plan":                   "lifetime",
      "subscription.status":                 "active",
      "subscription.currentPeriodStart":     new Date(),
      "subscription.currentPeriodEnd":       null,
      "subscription.cancelAtPeriodEnd":      false,
      "subscription.razorpaySubscriptionId": null,
    });

    await Payment.create({
      userId:            req.user._id,
      amount:            PLANS.lifetime.paise,
      plan:              "lifetime",
      status:            "captured",
      razorpayPaymentId: razorpay_payment_id,
      razorpayOrderId:   razorpay_order_id,
      billingCycle:      1,
    });

    logger.info(`Lifetime plan activated for user ${req.user._id} via payment ${razorpay_payment_id}`);
    success(res, { plan: "lifetime", status: "active" }, "Lifetime access activated! Welcome to Pro forever 🎉");
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createSubscription,
  verifySubscription,
  cancelSubscription,
  getStatus,
  getPaymentHistory,
  trackDownload,
  syncResumeCount,
  createLifetimeOrder,
  verifyLifetimePayment,
};
