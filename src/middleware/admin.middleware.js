"use strict";
const { error } = require("../utils/response");
const { ADMIN_PERMISSIONS } = require("../config/adminPermissions");

/** Route-level guard for a single admin-panel permission key. Requires
 *  `protect` (and typically the coarse admin-role `restrictTo`) to have
 *  already run so `req.user` is populated. */
const requirePermission = (key) => (req, res, next) => {
  const allowedRoles = ADMIN_PERMISSIONS[key];
  if (!allowedRoles) return error(res, `Unknown permission key: ${key}`, 500);
  if (!allowedRoles.includes(req.user?.role)) {
    return error(res, "You do not have permission to perform this action.", 403);
  }
  next();
};

module.exports = { requirePermission };
