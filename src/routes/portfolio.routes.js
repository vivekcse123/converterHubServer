"use strict";
const express = require("express");
const router  = express.Router();
const portfolio = require("../controllers/portfolio.controller");
const { protect } = require("../middleware/auth.middleware");
const { requiresPro } = require("../middleware/requiresPro.middleware");

// Protected routes
router.use(protect);

router.get("/",                          portfolio.getOwnPortfolio);
router.put("/",              requiresPro, portfolio.saveDraft);
router.post("/publish",      requiresPro, portfolio.publish);
router.post("/unpublish",    requiresPro, portfolio.unpublish);
router.post("/upload-image", requiresPro, portfolio.uploadImage);
router.get("/check-username/:username",  portfolio.checkUsername);

module.exports = router;
