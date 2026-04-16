#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  const User = require("../src/models/User");

  const email    = "admin@converterhub.com";
  const password = "Admin@1234";

  const existing = await User.findOne({ email });
  if (existing) {
    // Ensure role is superadmin
    existing.role = "superadmin";
    existing.isActive = true;
    existing.isBanned = false;
    await existing.save();
    console.log("Admin user already exists — role updated to superadmin.");
  } else {
    await User.create({
      name:     "Admin",
      email,
      password,
      role:     "superadmin",
      isActive: true,
    });
    console.log("Admin user created successfully.");
  }

  console.log("\n──────────────────────────────");
  console.log("  Email   :", email);
  console.log("  Password:", password);
  console.log("  Role    : superadmin");
  console.log("──────────────────────────────\n");

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
