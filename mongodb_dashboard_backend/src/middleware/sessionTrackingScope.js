'use strict';

/**
 * PUBLIC_INTERFACE
 * sessionTrackingScope
 * Middleware to enforce tenant- and user-scoped filtering for /api/session-tracking endpoints.
 *
 * Behavior:
 * - Derives tenantId from req.auth.tenantId (verifyAuth ensures this) and userId from req.auth.sub (or userId aliases).
 * - For all list/paginated requests, enforces filter to include:
 *     { tenant_id: tokenTenantId, user_id: tokenSub }
 *   ignoring any client-supplied tenant_id or user_id.
 * - For GET /:id, update, and delete operations, ensures queries are constrained by tenant_id (and user_id when applicable).
 *   This is achieved downstream via req.forcedFilter which crudFactory merges with client filters.
 *
 * Implementation details:
 * - Attaches req.forcedFilter = { tenant_id, user_id } to be merged by controllers.
 * - Attaches req.enforceSessionUserScope = true as a hint if other components need to detect this context.
 */
function sessionTrackingScope(req, res, next) {
  const tenantId = req?.auth?.tenantId || null;

  // Prefer sub but accept a couple of common aliases defensively
  const token = req?.auth || {};
  const userId =
    token.sub ||
    token.user_id ||
    token.userId ||
    token.id ||
    null;

  if (!tenantId || !userId) {
    // Auth/tenant middleware should already have responded; but guard defensively
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: missing tenant or user scope',
    });
  }

  // Forced filter used by CRUD controller to scope list queries
  req.forcedFilter = {
    tenant_id: String(tenantId),
    user_id: String(userId),
  };

  // Stamp for any consumers
  req.enforceSessionUserScope = true;

  // Debug log of applied forced filter (non-production only)
  try {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug(`[session-tracking.scope] ${req.method} ${req.originalUrl} enforced filter:`, req.forcedFilter);
    }
  } catch {}

  // Do not mutate incoming query/body here beyond attaching forced filter;
  // the controller will merge and override tenant_id/user_id to these values.
  return next();
}

module.exports = { sessionTrackingScope };
