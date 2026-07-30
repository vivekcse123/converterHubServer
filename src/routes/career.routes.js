"use strict";
const express = require("express");
const router  = express.Router();
const career  = require("../controllers/career.controller");
const { protect } = require("../middleware/auth.middleware");

// Protected routes
router.use(protect);

router.get("/stats",                   career.getCareerStats);
router.get("/jobs",                    career.getJobs);
router.post("/jobs",                   career.createJob);
router.patch("/jobs/:id",              career.updateJob);
router.delete("/jobs/:id",             career.deleteJob);
router.post("/jobs/:id/timeline",      career.addTimeline);

module.exports = router;
