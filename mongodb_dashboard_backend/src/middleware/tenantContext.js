'use strict';

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-BE-TENANT-CTX-001
// User Story: As a user, I want my selected tenant to be honored across requests so that the dashboard scopes data correctly.
// Acceptance Criteria:
// - Resolve active tenant from request (cookie/header/body)
// - Validate membership via RBAC
// - Populate req.tenant and fail with 400/409 if not selected for protected endpoints
// - Provide friendly remediation guidance
// GxP Impact: YES - Access control and data integrity scoping.
// Risk Level: MEDIUM
// Validation Protocol: VP-BE-TENANT-CTX-001
// ============================================================================
// IMPORTS AND DEPENDENCIES
// ============================================================================
 */

const AuditLog = require('../models/auditLog.model');
const { attachAuthContext, requireAuth } = require('./auth');
const { userHasTenant } = require('../utils/rbac');

/**
 * Resolve candidate tenant id from request via multiple sources for robustness.
 * Priority order:
 * 1. req.headers['x-tenant-id']
 * 2. cookie "activeTenant"
 * 3. req.body.tenantId (for POSTs)
 * 4. req.query.tenantId (fallback)
 */
function resolveTenantFromRequest(req) {
  const hdr = req.headers['x-tenant-id'] || req.headers['x-tenant'] || '';
  if (hdr && typeof hdr === 'string' && hdr.trim()) {return hdr.trim();}
  const cookieTenant = req.cookies?.activeTenant || req.signedCookies?.activeTenant;
  if (cookieTenant && typeof cookieTenant === 'string' && cookieTenant.trim()) {return cookieTenant.trim();}
  const bodyTenant = req.body && typeof req.body.tenantId === 'string' ? req.body.tenantId.trim() : '';
  if (bodyTenant) {return bodyTenant;}
  const queryTenant = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : '';
  if (queryTenant) {return queryTenant;}
  return '';
}

/**
// PUBLIC_INTERFACE
 * tenantOptional()
 * Middleware that attempts to attach req.tenant if resolvable and authorized.
 * Does not reject; downstream handlers can choose to require it or provide defaults.
 * @returns {function} Express middleware
 */
function tenantOptional() {
  return [
    attachAuthContext(),
    async function (req, res, next) {
      try {
        const candidate = resolveTenantFromRequest(req);
        if (!candidate) {return next();}
        // If user present, validate membership
        if (req.user && req.user.id) {
          if (!userHasTenant(req.user, candidate)) {
            // Not authorized for this tenant; do not attach tenant but continue
            return next();
          }
        }
        req.tenant = { id: candidate };
        return next();
      } catch (e) {
         
        console.error('[tenantOptional] error', e);
        return next();
      }
    },
  ];
}

/**
// PUBLIC_INTERFACE
 * requireTenant()
 * Middleware that enforces a valid selected tenant and RBAC membership.
 * Responds 400 if none selected, 403 if user not authorized, with guidance.
 * @returns {function} Express middleware
 */
function requireTenant() {
  return [
    attachAuthContext(),
    requireAuth(),
    async function (req, res, next) {
      const candidate = resolveTenantFromRequest(req);

      if (!candidate) {
        // Audit READ failure context: tenant missing
        await AuditLog.create({
          action: 'READ',
          resource: 'tenant.context',
          path: req.originalUrl,
          method: req.method,
          user_id: req.user?.id || null,
          ip: req.ip,
          user_agent: req.headers['user-agent'] || '',
          before: null,
          after: null,
          outcome: 'FAILURE',
          trace_id: req.traceId || null,
          reason: 'Missing active tenant selection',
        }).catch(() => {});
        return res.status(409).json({
          success: false,
          message: 'Tenant selection required.',
          remediation: 'Call POST /api/session/tenant with { tenantId } or use the tenant selection UI after sign-in.',
          docs: '/docs',
        });
      }

      if (!userHasTenant(req.user, candidate)) {
        await AuditLog.create({
          action: 'READ',
          resource: 'tenant.context',
          path: req.originalUrl,
          method: req.method,
          user_id: req.user?.id || null,
          ip: req.ip,
          user_agent: req.headers['user-agent'] || '',
          before: { requestedTenant: candidate },
          after: null,
          outcome: 'FAILURE',
          trace_id: req.traceId || null,
          reason: 'User not authorized for tenant',
        }).catch(() => {});
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to access this tenant.',
        });
      }

      req.tenant = { id: candidate };
      return next();
    },
  ];
}

module.exports = {
  tenantOptional,
  requireTenant,
};