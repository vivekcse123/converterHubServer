"use strict";
const express = require("express");
const router = express.Router();
const admin = require("../controllers/adminPortfolio.controller");
const { requirePermission } = require("../middleware/admin.middleware");

// Mounted at /api/admin/portfolios by admin.routes.js — protect/restrictTo
// already applied at that parent router level.
router.get("/", requirePermission("portfolios.view"), admin.getPortfolios);
router.get("/:id", requirePermission("portfolios.view"), admin.getPortfolio);
router.patch("/:id/feature", requirePermission("portfolios.moderate"), admin.featurePortfolio);
router.patch("/:id/hide", requirePermission("portfolios.moderate"), admin.hidePortfolio);
router.delete("/:id", requirePermission("portfolios.delete"), admin.deletePortfolio);

module.exports = router;
