"use strict";

/**
 * Single source of truth for admin-panel RBAC. Server-authoritative — the
 * frontend never hardcodes role→permission mapping, it only asks
 * GET /api/admin/me/permissions what the current user can do and hides UI
 * accordingly. Keys are dot-namespaced by module so this same map drives
 * both the Express route middleware (requirePermission) and that endpoint.
 *
 * Role summary:
 *  - moderator: portfolio moderation (feature/hide) + read-only users
 *  - support:   users read + safe moderation (suspend/ban/reset-usage) + payments read
 *  - editor:    settings (plans/branding) + read-only analytics
 *  - admin:     everything except assigning the superadmin role (enforced
 *               separately in admin.controller.js's updateUser, since it
 *               depends on the *requester's* role, not a static allowlist)
 *  - superadmin: unrestricted
 */
const ADMIN_PERMISSIONS = {
  "users.view":                 ["admin", "superadmin", "support", "moderator"],
  "users.edit":                 ["admin", "superadmin"],
  "users.delete":                ["admin", "superadmin"],
  "users.role.assign":           ["admin", "superadmin"],
  "users.moderate":              ["admin", "superadmin", "support"],
  "users.subscription.manage":   ["admin", "superadmin"],

  "portfolios.view":             ["admin", "superadmin", "moderator"],
  "portfolios.moderate":         ["admin", "superadmin", "moderator"],
  "portfolios.delete":           ["admin", "superadmin"],

  "conversions.view":            ["admin", "superadmin", "support", "moderator"],
  "conversions.manage":          ["admin", "superadmin"],

  "payments.view":               ["admin", "superadmin", "support"],
  "payments.manage":             ["admin", "superadmin"],

  "analytics.view":              ["admin", "superadmin", "editor", "support", "moderator"],

  "activity.view":               ["admin", "superadmin"],

  "settings.plans.manage":       ["admin", "superadmin", "editor"],
  "settings.branding.manage":    ["admin", "superadmin", "editor"],
  "settings.logs.view":          ["admin", "superadmin"],
};

module.exports = { ADMIN_PERMISSIONS };
