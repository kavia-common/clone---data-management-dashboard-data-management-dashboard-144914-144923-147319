'use strict';

/**
 * PUBLIC_INTERFACE
 * sessionTrackingScope
 * Middleware to enforce tenant-scoped filtering for /api/session-tracking endpoints.
 *
 * Tenant-only scope policy:
 * - UI should only see data for the active tenant from the JWT.
 * - We DO NOT scope by user_id; multi-user tenant views are allowed.
 *
 * Behavior:
 * - Derives tenantId from req.auth.tenantId (verifyAuth ensures this).
 * - For list and ID-based operations, enforces a forced filter:
 *     { tenant_id: tokenTenantId }
 *   ignoring any client-supplied tenant_id.
 * - Downstream crudFactory merges req.forcedFilter LAST to guarantee enforcement.
 *
 * Implementation details:
 * - Attaches req.forcedFilter = { tenant_id } to be merged by controllers.
 * - Attaches req.enforceSessionTenantScope = true as a hint if other components need to detect this context.
 */
function sessionTrackingScope(req, res, next) {
  const tenantId = req?.auth?.tenantId || null;

  if (!tenantId) {
    // Auth/tenant middleware should already have responded; but guard defensively
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: missing tenant scope',
    });
  }

  // Forced filter used by CRUD controller to scope list queries and all ID-based operations.
  // This is merged LAST in crudFactory, taking precedence over any client-provided filter.
  req.forcedFilter = {
    tenant_id: String(tenantId),
  };

  // Stamp for any consumers
  req.enforceSessionTenantScope = true;
  // Hint to CRUD layer to aggressively stamp/override tenant on writes
  req.strictTenantEnforce = true;

  // Debug log of applied forced filter (non-production only)
  try {
    if (process.env.NODE_ENV !== 'production') {
       
      console.debug(`[session-tracking.scope] ${req.method} ${req.originalUrl} enforced filter:`, req.forcedFilter);
    }
  } catch {}

  // Do not mutate incoming query/body here beyond attaching forced filter;
  // the controller will merge and override tenant_id to this value.
  return next();
}

module.exports = { sessionTrackingScope };