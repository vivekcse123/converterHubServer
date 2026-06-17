"use strict";
const express = require("express");
const router  = express.Router();
const { razorpayWebhook } = require("../controllers/webhook.controller");

// Razorpay sends raw JSON — no auth middleware here
router.post("/razorpay", razorpayWebhook);

module.exports = router;
