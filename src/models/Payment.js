"use strict";
const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount:   { type: Number, required: true },           // paise
    currency: { type: String, default: "INR" },
    plan:     { type: String, enum: ["monthly", "yearly", "lifetime"], required: true },
    status:   { type: String, enum: ["captured", "failed", "refunded"], default: "captured" },
    razorpayPaymentId:      String,
    razorpayOrderId:        String,
    razorpaySubscriptionId: String,
    invoiceNumber:          { type: String, unique: true, sparse: true },
    billingCycle:           Number,   // which renewal number this is
  },
  { timestamps: true }
);

paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });   // admin revenue reports / failed-payment dashboards
paymentSchema.index({ plan: 1, createdAt: -1 });      // plan-breakdown analytics

// Auto-generate invoice number before save
paymentSchema.pre("save", function (next) {
  if (!this.invoiceNumber) {
    const ts   = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
    this.invoiceNumber = `INV-${ts}-${rand}`;
  }
  next();
});

module.exports = mongoose.model("Payment", paymentSchema);
