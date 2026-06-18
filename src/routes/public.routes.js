"use strict";
const express = require("express");
const router  = express.Router();
const career  = require("../controllers/career.controller");
const share   = require("../controllers/share.controller");

// Public (no auth) routes
router.get("/portfolio/:username", career.getPublicPortfolio);
router.get("/r/:slug",             share.getPublicResume);

module.exports = router;
