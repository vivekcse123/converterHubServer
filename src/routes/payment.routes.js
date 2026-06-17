"use strict";
const express = require("express");
const { body } = require("express-validator");
const router  = express.Router();
const { createOrder, verifyPayment, getPurchases } = require("../controllers/payment.controller");
const { protect } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");

// All payment routes require authentication
router.use(protect);

router.post(
  "/create-order",
  [body("templateId").notEmpty().isString()],
  validate,
  createOrder
);

router.post(
  "/verify",
  [
    body("razorpay_order_id").notEmpty(),
    body("razorpay_payment_id").notEmpty(),
    body("razorpay_signature").notEmpty(),
    body("templateId").notEmpty().isString(),
  ],
  validate,
  verifyPayment
);

router.get("/purchases", getPurchases);

module.exports = router;
