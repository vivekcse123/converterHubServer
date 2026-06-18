"use strict";
const express = require("express");
const router = express.Router();
const { protect: authenticate } = require("../middleware/auth.middleware");
const share = require("../controllers/share.controller");

router.post  ("/resume",              authenticate, share.publishResume);
router.delete("/resume/:resumeId",    authenticate, share.unpublishResume);
router.get   ("/resume/:resumeId/status", authenticate, share.getShareStatus);

module.exports = router;
