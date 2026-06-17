"use strict";
const Razorpay = require("razorpay");

let _instance = null;

function getRazorpay() {
  if (_instance) return _instance;
  const key_id     = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in environment variables.");
  }
  _instance = new Razorpay({ key_id, key_secret });
  return _instance;
}

module.exports = { getRazorpay };
