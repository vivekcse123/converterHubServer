"use strict";
const express = require("express");
const router = express.Router();
const { getTrendingConverters } = require("../controllers/admin.controller");

// GET /api/converters/trending — public, no auth required
router.get("/trending", getTrendingConverters);

module.exports = router;
