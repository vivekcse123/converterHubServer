"use strict";
const crypto  = require("crypto");
const User    = require("../models/User");
const Payment = require("../models/Payment");
const logger  = require("../utils/logger");

const PLANS = {
  monthly: 900,
  yearly:  9900,
};

// POST /api/webhooks/razorpay  (raw body required — configured in app.js)
const razorpayWebhook = async (req, res) => {
  try {
    // Verify webhook signature
    const secret    = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (secret && signature) {
      const expected = crypto
        .createHmac("sha256", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (expected !== signature) {
        logger.warn("Razorpay webhook signature mismatch");
        return res.status(400).json({ ok: false });
      }
    }

    const event   = req.body.event;
    const payload = req.body.payload;

    logger.info(`Razorpay webhook: ${event}`);

    switch (event) {
      case "subscription.activated": {
        const sub    = payload.subscription.entity;
        const plan   = sub.notes?.plan ?? "monthly";
        const userId = sub.notes?.userId;
        if (!userId) break;

        const now = new Date();
        const end = plan === "monthly"
          ? new Date(now.setMonth(now.getMonth() + 1))
          : new Date(now.setFullYear(now.getFullYear() + 1));

        await User.findByIdAndUpdate(userId, {
          "subscription.plan":                   plan,
          "subscription.status":                 "active",
          "subscription.razorpaySubscriptionId": sub.id,
          "subscription.currentPeriodStart":     new Date(),
          "subscription.currentPeriodEnd":       new Date(sub.current_end * 1000 || end),
          "subscription.cancelAtPeriodEnd":      false,
        });
        break;
      }

      case "subscription.charged": {
        const payment = payload.payment?.entity;
        const sub     = payload.subscription?.entity;
        if (!payment || !sub) break;

        const userId = sub.notes?.userId;
        const plan   = sub.notes?.plan ?? "monthly";
        if (!userId) break;

        const end = plan === "monthly"
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

        await User.findByIdAndUpdate(userId, {
          "subscription.status":           "active",
          "subscription.currentPeriodEnd": new Date(sub.current_end * 1000 || end),
        });

        // Record renewal payment
        const exists = await Payment.findOne({ razorpayPaymentId: payment.id });
        if (!exists) {
          await Payment.create({
            userId,
            amount:                 PLANS[plan] ?? payment.amount,
            plan,
            status:                 "captured",
            razorpayPaymentId:      payment.id,
            razorpaySubscriptionId: sub.id,
            billingCycle:           sub.paid_count,
          });
        }
        break;
      }

      case "subscription.cancelled":
      case "subscription.completed": {
        const sub    = payload.subscription.entity;
        const userId = sub.notes?.userId;
        if (!userId) break;

        await User.findByIdAndUpdate(userId, {
          "subscription.status":      event === "subscription.cancelled" ? "cancelled" : "expired",
          "subscription.cancelledAt": new Date(),
        });
        break;
      }

      case "subscription.pending":
      case "payment.failed": {
        const sub    = payload.subscription?.entity;
        const userId = sub?.notes?.userId;
        if (userId) {
          await User.findByIdAndUpdate(userId, {
            "subscription.status": "past_due",
          });
        }
        break;
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error(`Webhook error: ${err.message}`);
    res.status(500).json({ ok: false });
  }
};

module.exports = { razorpayWebhook };
