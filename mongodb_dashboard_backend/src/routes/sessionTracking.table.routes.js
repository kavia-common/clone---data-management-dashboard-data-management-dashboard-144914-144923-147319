const express = require('express');

/**
 * Session Tracking Table Routes
 *
 * This router exists to provide a stable, isolated endpoint for the Sessions page
 * *table* list fetch. The composite/analytics endpoints should not share query state
 * with the table list request in the frontend.
 *
 * TOKEN / AUTH FLOW (important for debugging tenant + search issues)
 * - This router itself does NOT implement auth verification; it delegates to the underlying list router.
 * - In the full application, auth is typically applied at the app/router-mount level via middleware
 *   such as `verifyAuth` (JWT Bearer token parsing) and/or tenant enforcement middleware.
 * - If an Authorization: Bearer <JWT> header is present and verifyAuth is enabled upstream:
 *     - verifyAuth verifies the JWT signature using JWT_SECRET/JWT_ALG.
 *     - it populates req.auth (e.g., { sub, email, tenantId, scope, ... }).
 *     - other middleware may set req.user / RBAC flags (e.g., super admin).
 * - Tenant scoping for this endpoint:
 *     - When the “all tenants” sentinel T0000 is used (query/header), the route bypasses tenant enforcement
 *       to allow cross-tenant viewing in demo/admin scenarios.
 *     - Otherwise, the effective tenant is resolved from req.tenantId / query / headers, and applied to the DB filter.
 *
 * SEARCH FLOW
 * - Query param `q` is applied ONLY to the session_tracking DB field `User_name` (capital U).
 * - Set env SESSION_TRACKING_Q_EXACT=true to force case-insensitive exact match on User_name.
 *
 * Implementation notes:
 * - We reuse the exact same handler flow as the existing /api/session-tracking GET list.
 * - We mount it under a different path so callers can clearly separate concerns.
 * - This avoids patchy duplication: we delegate to the already-maintained list router.
 */

const listRouter = require('./sessionTracking.routes');

const router = express.Router();

// PUBLIC_INTERFACE
router.use('/', listRouter);
/** This router re-exports the existing session tracking list+CRUD behavior under a table-specific base path. */

module.exports = router;
