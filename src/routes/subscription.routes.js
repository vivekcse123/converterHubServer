"use strict";
const express = require("express");
const { body } = require("express-validator");
const router  = express.Router();
const {
  createSubscription, verifySubscription, cancelSubscription,
  getStatus, getPaymentHistory, trackDownload, syncResumeCount,
  createLifetimeOrder, verifyLifetimePayment,
} = require("../controllers/subscription.controller");
const { protect } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");

router.use(protect);

router.post(
  "/create",
  [body("plan").isIn(["monthly", "yearly"])],
  validate,
  createSubscription
);

router.post(
  "/verify",
  [
    body("razorpay_subscription_id").notEmpty(),
    body("razorpay_payment_id").notEmpty(),
    body("razorpay_signature").notEmpty(),
    body("plan").isIn(["monthly", "yearly"]),
  ],
  validate,
  verifySubscription
);

router.post("/cancel",           cancelSubscription);
router.get("/status",            getStatus);
router.get("/payments",          getPaymentHistory);
router.post("/track-download",   trackDownload);
router.post("/sync-resumes",     [body("count").isInt({ min: 0 })], validate, syncResumeCount);
router.post("/create-lifetime",  createLifetimeOrder);
router.post(
  "/verify-lifetime",
  [
    body("razorpay_order_id").notEmpty(),
    body("razorpay_payment_id").notEmpty(),
    body("razorpay_signature").notEmpty(),
  ],
  validate,
  verifyLifetimePayment
);

module.exports = router;
