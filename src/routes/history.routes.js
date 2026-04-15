"use strict";

const express = require("express");
const router = express.Router();

const {
  getHistory,
  deleteHistory,
} = require("../controllers/history.controller");
const { protect } = require("../middleware/auth.middleware");

// All history routes require authentication
router.use(protect);

router.get("/", getHistory);
router.delete("/:id", deleteHistory);

module.exports = router;
