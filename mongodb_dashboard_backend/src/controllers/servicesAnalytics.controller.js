'use strict';

const { getServiceTypesSummary } = require('../services/servicesAnalytics.service');
const { resolveOrganizationFromRequest } = require('../middleware/tenantScope') || {};

/**
 * PUBLIC_INTERFACE
 * GET /api/services/summary
 * Aggregates SessionTracking counts grouped by service_type with date filtering and tenant scoping.
 * Accepts: range=daily|weekly|monthly|custom, start_date, end_date (YYYY-MM-DD)
 * Organization scoping via Authorization JWT when present; otherwise via x-organization-id header or ?organization_id/tenant_id query.
 * Super admin bypass: if organizationId === 'T0000' allows cross-tenant; when include_org_buckets=1, returns orgBuckets.
 */
async function servicesSummaryHandler(req, res, next) {
  try {
    const range = (req.query.range || 'daily').toString();
    const start_date = req.query.start_date ? String(req.query.start_date) : undefined;
    const end_date = req.query.end_date ? String(req.query.end_date) : undefined;

    // Organization scoping parity: prefer JWT tenant when present, fallback header then query aliases
    let orgId = null;

    // Priority: JWT via middleware if set
    if (req.auth && req.auth.tenantId) {
      orgId = req.auth.tenantId;
    }

    // Header override only when no JWT tenant present
    if (!orgId) {
      orgId = req.headers['x-organization-id'] || req.headers['x-tenant-id'] || null;
    }

    // Query aliases
    if (!orgId) {
      orgId = req.query.organization_id || req.query.tenant_id || null;
    }

    // If still missing, in demo we may allow but other endpoints generally require tenant unless super-admin
    if (!orgId) {
      return res.status(400).json({ error: 'Missing tenant scope (x-organization-id header or organization_id/tenant_id query). Super admin may use T0000.' });
    }

    const includeOrgBuckets = (req.query.include_org_buckets === '1' || req.query.include_org_buckets === 'true');

    const data = await getServiceTypesSummary({
      organizationId: orgId,
      range,
      start_date,
      end_date,
      includeOrgBuckets
    });

    res.status(200).json(data);
  } catch (err) {
    if (err && /required when range=custom/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

module.exports = {
  servicesSummaryHandler
};
