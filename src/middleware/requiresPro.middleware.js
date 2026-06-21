"use strict";
const { error } = require("../utils/response");

const requiresPro = (req, res, next) => {
  const sub = req.user?.subscription;
  const isAdmin = ["admin", "superadmin"].includes(req.user?.role);
  const isPro   = isAdmin || (sub?.status === "active" && ["monthly", "yearly", "lifetime"].includes(sub?.plan));

  if (!isPro) {
    return error(res, "This feature requires a Pro subscription. Upgrade at /resume-builder/pricing.", 403);
  }
  next();
};

module.exports = { requiresPro };
