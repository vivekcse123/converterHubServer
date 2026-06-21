#!/usr/bin/env node
/**
 * Run once: node src/scripts/setup-razorpay-plans.js
 * Creates the monthly and yearly plans on Razorpay and prints the plan IDs.
 * Copy the IDs into your .env and Render environment variables.
 */
"use strict";
require("dotenv").config();
const { getRazorpay } = require("../config/razorpay");

async function main() {
  const rzp = getRazorpay();

  console.log("Creating Razorpay plans...\n");

  const monthly = await rzp.plans.create({
    period:   "monthly",
    interval: 1,
    item: {
      name:        "ApnaConverter Pro Monthly",
      amount:      9900,   // ₹99 in paise
      currency:    "INR",
      description: "Pro Monthly — all templates, no watermark, cover letter, portfolio, job tracker, AI assistant",
    },
    notes: { plan: "monthly" },
  });

  const yearly = await rzp.plans.create({
    period:   "yearly",
    interval: 1,
    item: {
      name:        "ApnaConverter Pro Yearly",
      amount:      69900,  // ₹699 in paise
      currency:    "INR",
      description: "Pro Yearly — everything in monthly + 5 months free + early template access",
    },
    notes: { plan: "yearly" },
  });

  console.log("✅ Plans created! Add these to your .env and Render:\n");
  console.log(`RAZORPAY_PLAN_MONTHLY=${monthly.id}`);
  console.log(`RAZORPAY_PLAN_YEARLY=${yearly.id}`);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Error creating plans:", err.message);
  process.exit(1);
});
