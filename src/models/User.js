"use strict";
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const userCache = require("../utils/userCache");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      select: false,
    },

    // Roles: user | premium | admin | superadmin | editor | support | moderator
    // The last three are admin-panel-only roles with restricted permissions —
    // see config/adminPermissions.js for exactly what each can do.
    role: {
      type: String,
      enum: ["user", "premium", "admin", "superadmin", "editor", "support", "moderator"],
      default: "user",
      index: true,
    },

    // Account status
    isActive: { type: Boolean, default: true, index: true },
    isBanned: { type: Boolean, default: false },
    isSuspended: { type: Boolean, default: false },
    banReason: String,
    suspendedUntil: Date,

    // Subscription (Razorpay)
    subscription: {
      plan: {
        type: String,
        enum: ["free", "monthly", "yearly", "lifetime"],
        default: "free",
      },
      status: {
        type: String,
        enum: ["free", "active", "past_due", "cancelled", "expired"],
        default: "free",
      },
      razorpaySubscriptionId: String,
      currentPeriodStart: Date,
      currentPeriodEnd:   Date,   // null for lifetime plans
      cancelAtPeriodEnd:  { type: Boolean, default: false },
      cancelledAt:        Date,
      resumeCount:        { type: Number, default: 0 },
      totalDownloads:     { type: Number, default: 0 },
      // Admin-granted access fields
      grantedByAdmin:  { type: Boolean, default: false },
      adminNotes:      String,
      adminGrantedAt:  Date,
      adminGrantedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },

    // Usage tracking (reset daily via cron)
    usage: {
      conversionsToday: { type: Number, default: 0 },
      aiRequestsToday: { type: Number, default: 0 },
      // Separate from aiRequestsToday — the ATS Resume Checker is a headline
      // feature with its own quota, not a slice of the general AI budget.
      atsScansToday: { type: Number, default: 0 },
      totalConversions: { type: Number, default: 0 },
      totalFilesUploaded: { type: Number, default: 0 },
      totalStorageUsed: { type: Number, default: 0 }, // bytes
      lastUsageReset: { type: Date, default: Date.now },
    },

    // Template purchases (per-template one-time payments)
    templatePurchases: [
      {
        templateId: { type: String, required: true },
        orderId:    String,
        paymentId:  String,
        amount:     Number,
        purchasedAt: { type: Date, default: Date.now },
      },
    ],

    // Google OAuth linkage (unset for password-only accounts)
    googleId: { type: String, index: { sparse: true, unique: true } },

    // Auth tokens
    refreshTokens: [
      { token: String, createdAt: { type: Date, default: Date.now } },
    ],
    passwordResetToken: { type: String, index: { sparse: true } },
    passwordResetExpires: Date,

    // Metadata
    lastLoginAt: Date,
    lastLoginIp: String,
    loginCount: { type: Number, default: 0 },
    // Last 20 logins (password + Google), newest last — powers the admin
    // Users module's Sessions/device-history tab.
    loginHistory: [
      { ip: String, userAgent: String, at: { type: Date, default: Date.now } },
    ],
    avatar: String,
    timezone: { type: String, default: "UTC" },

    // Admin notes
    adminNotes: String,
  },
  { timestamps: true },
);

// Indexes
userSchema.index({ "subscription.plan": 1 });
userSchema.index({ "subscription.status": 1 });
userSchema.index({ createdAt: -1 });
// Compound indexes for common query patterns
userSchema.index({ email: 1, isActive: 1 });   // login + active-check in one hit
userSchema.index({ isActive: 1, role: 1 });    // admin user-list filtering
userSchema.index({ isBanned: 1, createdAt: -1 });
userSchema.index({ passwordResetToken: 1, passwordResetExpires: 1 }, { sparse: true });
// Sparse: excludes users who've never logged in — keeps the index small
userSchema.index({ lastLoginAt: -1 }, { sparse: true });

// Auto-invalidate the in-process user cache on any mutation so auth middleware
// never serves stale subscription / ban state beyond the TTL window.
userSchema.post("save", function () { userCache.invalidate(this._id); });
userSchema.post("findOneAndUpdate", function (doc) { if (doc) userCache.invalidate(doc._id); });

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (plainText) {
  return bcrypt.compare(plainText, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokens;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  return obj;
};

// Check if user is allowed to convert (daily limit)
userSchema.methods.canConvert = function (planLimits) {
  const limit = planLimits?.[this.subscription.plan]?.conversionsPerDay ?? 5;
  if (limit === -1) return true; // unlimited
  return this.usage.conversionsToday < limit;
};

userSchema.methods.canUseAI = function (planLimits) {
  const limit = planLimits?.[this.subscription.plan]?.aiRequestsPerDay ?? 3;
  if (limit === -1) return true;
  return this.usage.aiRequestsToday < limit;
};

module.exports = mongoose.model("User", userSchema);
