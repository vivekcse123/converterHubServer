"use strict";
const mongoose = require("mongoose");

const planSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, required: true }, // "free","pro","team","enterprise"
    name: { type: String, required: true },
    description: String,
    price: { monthly: Number, yearly: Number },
    stripePriceId: { monthly: String, yearly: String },

    limits: {
      maxFileSizeMb: { type: Number, default: 10 },
      conversionsPerDay: { type: Number, default: 5 },
      aiRequestsPerDay: { type: Number, default: 3 },
      maxBatchFiles: { type: Number, default: 5 },
      storageMb: { type: Number, default: 100 },
    },

    features: [String], // Feature flag names

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Plan", planSchema);
