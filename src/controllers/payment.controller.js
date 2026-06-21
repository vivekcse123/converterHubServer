"use strict";
const crypto = require("crypto");
const User   = require("../models/User");
const { getRazorpay } = require("../config/razorpay");
const { success, error } = require("../utils/response");
const logger = require("../utils/logger");

const PREMIUM_TEMPLATE_IDS = [
  "ats-professional", "modern-professional", "tech",
  "sidebar-pro", "banner-dark", "timeline-pro", "corporate-pro",
  "executive-elite", "luxury-gold", "creative-portfolio-pro",
  "startup-founder", "product-manager-pro",
  "photo-government", "photo-executive",
];
const TEMPLATE_PRICE_PAISE = 2900; // ₹29 in paise

// POST /api/payments/create-order
const createOrder = async (req, res, next) => {
  try {
    const { templateId } = req.body;

    if (!PREMIUM_TEMPLATE_IDS.includes(templateId)) {
      return error(res, "This is not a premium template.", 400);
    }

    const alreadyOwned = (req.user.templatePurchases || []).some(
      (p) => p.templateId === templateId
    );
    if (alreadyOwned) {
      return error(res, "You have already purchased this template.", 400);
    }

    const razorpay = getRazorpay();
    const order = await razorpay.orders.create({
      amount:   TEMPLATE_PRICE_PAISE,
      currency: "INR",
      receipt:  `tpl_${templateId}_${Date.now()}`,
      notes:    { templateId, userId: req.user._id.toString() },
    });

    logger.info(`Razorpay order created: ${order.id} for template ${templateId} by user ${req.user._id}`);

    success(res, {
      orderId:    order.id,
      amount:     order.amount,
      currency:   order.currency,
      keyId:      process.env.RAZORPAY_KEY_ID,
      templateId,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/payments/verify
const verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, templateId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !templateId) {
      return error(res, "Missing required payment fields.", 400);
    }

    if (!PREMIUM_TEMPLATE_IDS.includes(templateId)) {
      return error(res, "Invalid template ID.", 400);
    }

    // Verify Razorpay HMAC signature — NEVER trust the client alone
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      logger.warn(`Payment signature mismatch for order ${razorpay_order_id} by user ${req.user._id}`);
      return error(res, "Payment verification failed — signature mismatch.", 400);
    }

    // Idempotent: if already purchased, just return success
    const alreadyOwned = (req.user.templatePurchases || []).some(
      (p) => p.templateId === templateId
    );
    if (alreadyOwned) {
      return success(res, { templateId }, "Template already unlocked.");
    }

    await User.findByIdAndUpdate(req.user._id, {
      $push: {
        templatePurchases: {
          templateId,
          orderId:     razorpay_order_id,
          paymentId:   razorpay_payment_id,
          amount:      TEMPLATE_PRICE_PAISE,
          purchasedAt: new Date(),
        },
      },
    });

    logger.info(`Template ${templateId} unlocked for user ${req.user._id} via payment ${razorpay_payment_id}`);
    success(res, { templateId }, "Template unlocked successfully! 🎉");
  } catch (err) {
    next(err);
  }
};

// GET /api/payments/purchases  — returns the current user's purchased template IDs
const getPurchases = (req, res) => {
  const purchases   = req.user.templatePurchases || [];
  const templateIds = purchases.map((p) => p.templateId);
  success(res, { templateIds, purchases });
};

module.exports = { createOrder, verifyPayment, getPurchases };
