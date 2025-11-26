'use strict';

const { getLlmCostsOverTime } = require('../services/llmCosts.overTime.service');
const { recordAudit } = require('../services/auditTrail');

/**
// PUBLIC_INTERFACE
 * getLlmCostsOverTimeController
 * GET /api/analytics/llm-costs/over-time
 * Query:
 *  - granularity: 'day'|'week'|'month' (default 'day')
 *  - from: ISO date-time (optional; default: 30 days ago)
 *  - to: ISO date-time (optional; default: now)
 * Behavior:
 *  - Enforces tenant scoping unless super-admin/T0000 bypass is detected.
 *  - Returns JSON { labels, datasets: [{label, data}], meta: { from, to, granularity } }
 */
async function getLlmCostsOverTimeController(req, res) {
  try {
    // Tenant scoping resolution (consistent with other analytics routes)
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.analyticsAllTenantsBypass);
    let tenantId = null;
    if (!bypass) {
      tenantId =
        req.tenantId ||
        req.organizationId ||
        (req.auth && req.auth.tenantId ? String(req.auth.tenantId) : null) ||
        (typeof req.headers?.['x-organization-id'] === 'string' ? req.headers['x-organization-id'] : null) ||
        (typeof req.query?.organization_id === 'string' ? req.query.organization_id : null) ||
        (typeof req.query?.tenant_id === 'string' ? req.query.tenant_id : null);
      if (tenantId) tenantId = String(tenantId);
    } else {
      try { res.set('X-All-Tenants', 'true'); } catch (_) {}
    }

    const granularity = String(req.query?.granularity || 'day');
    const from = req.query?.from || null;
    const to = req.query?.to || null;

    const result = await getLlmCostsOverTime({ tenantId, from, to, granularity });

    // Audit (READ)
    recordAudit({
      action: 'READ',
      resource: 'analytics.llm-costs.over-time',
      user_id: req.user?.id || req.user?._id || null,
      outcome: 'SUCCESS',
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
      user_agent: req.get('user-agent') || '',
    }).catch(() => {});

    res.set('Cache-Control', 'no-store');
    return res.status(200).json(result);
  } catch (err) {
    recordAudit({
      action: 'READ',
      resource: 'analytics.llm-costs.over-time',
      user_id: req.user?.id || req.user?._id || null,
      outcome: 'ERROR',
      reason: err?.message || 'Unknown error',
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
      user_agent: req.get('user-agent') || '',
    }).catch(() => {});

    console.error('[analytics] /llm-costs/over-time failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to aggregate LLM costs over time' });
  }
}

module.exports = {
  getLlmCostsOverTimeController,
};
