"use strict";
const express = require("express");
const router  = express.Router();
const portfolio = require("../controllers/portfolio.controller");
const share   = require("../controllers/share.controller");

// Public (no auth) routes
router.get("/portfolio/:username", portfolio.getPublicPortfolio);
router.get("/r/:slug",             share.getPublicResume);

module.exports = router;
