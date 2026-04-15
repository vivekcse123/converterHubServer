"use strict";
const express = require("express");
const router = express.Router();
const jobs = require("../controllers/jobs.controller");
const { protect, optionalAuth } = require("../middleware/auth.middleware");

// User's own jobs (optional auth — session-based for anon users)
router.use(optionalAuth);
router.get("/", jobs.getUserJobs);
router.get("/:id", jobs.getJob);
router.delete("/:id", protect, jobs.cancelJob);

module.exports = router;
