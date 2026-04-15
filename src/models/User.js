"use strict";
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const userSchema = new mongoose.Schema({
  name:     { type: String, required: [true, "Name is required"], trim: true, minlength: 2, maxlength: 50 },
  email:    { type: String, required: [true, "Email is required"], unique: true, lowercase: true, trim: true,
              match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"] },
  password: { type: String, required: [true, "Password is required"], minlength: 8, select: false },

  // Roles: user | premium | admin | superadmin
  role:     { type: String, enum: ["user","premium","admin","superadmin"], default: "user", index: true },

  // Account status
  isActive:   { type: Boolean, default: true, index: true },
  isBanned:   { type: Boolean, default: false },
  isSuspended:{ type: Boolean, default: false },
  banReason:  String,
  suspendedUntil: Date,

  // Subscription
  subscription: {
    plan:        { type: String, enum: ["free","pro","team","enterprise"], default: "free" },
    status:      { type: String, enum: ["active","cancelled","expired","trialing"], default: "active" },
    stripeCustomerId:     String,
    stripeSubscriptionId: String,
    currentPeriodEnd:     Date,
    cancelAtPeriodEnd:    { type: Boolean, default: false },
  },

  // Usage tracking (reset daily via cron)
  usage: {
    conversionsToday:  { type: Number, default: 0 },
    aiRequestsToday:   { type: Number, default: 0 },
    totalConversions:  { type: Number, default: 0 },
    totalFilesUploaded:{ type: Number, default: 0 },
    totalStorageUsed:  { type: Number, default: 0 },  // bytes
    lastUsageReset:    { type: Date, default: Date.now },
  },

  // Auth tokens
  refreshTokens: [{ token: String, createdAt: { type: Date, default: Date.now } }],
  passwordResetToken:   String,
  passwordResetExpires: Date,

  // Metadata
  lastLoginAt:  Date,
  lastLoginIp:  String,
  loginCount:   { type: Number, default: 0 },
  avatar:       String,
  timezone:     { type: String, default: "UTC" },

  // Admin notes
  adminNotes: String,
}, { timestamps: true });

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ "subscription.plan": 1 });
userSchema.index({ createdAt: -1 });

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
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
  if (limit === -1) return true;  // unlimited
  return this.usage.conversionsToday < limit;
};

userSchema.methods.canUseAI = function (planLimits) {
  const limit = planLimits?.[this.subscription.plan]?.aiRequestsPerDay ?? 3;
  if (limit === -1) return true;
  return this.usage.aiRequestsToday < limit;
};

module.exports = mongoose.model("User", userSchema);
