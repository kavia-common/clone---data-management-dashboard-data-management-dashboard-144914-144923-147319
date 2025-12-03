'use strict';

const User = require('../models/user.model');
const Project = require('../models/project.model');

/**
 * Utility: safely coerce any value to a finite number (defaults to 0).
 */
function toNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

/**
 * PUBLIC_INTERFACE
 * getAggregatedCosts
 * Controller for GET /api/llm-costs (aggregated view)
 * Returns aggregated users and projects arrays that include cost fields.
 * Tenant scoping:
 * - The server enforces tenant scoping using req.tenantId resolved via (in order): header x-organization-id, query ?tenant_id or ?organization_id, or JWT.
 * - Any client-provided tenant_id/organization_id in payloads/filters are ignored in favor of the resolved tenant.
 *
 * Shape:
 *  {
 *    users: [ { _id, name, email, user_cost, ... } ],
 *    projects: [ { _id, name, project_cost, ownerUserId, ... } ]
 *  }
 *
 * Logic:
 * - Reads from existing collections if present:
 *   • users: looks for user_cost at doc.user_cost (defaults 0)
 *   • projects: looks for project_cost at doc.project_cost (defaults 0) and owner user id at owner_user_id | ownerUserId
 * - Only minimal projection for performance; does not enforce schema.
 * - Robust error handling: returns 500 with { message } on unexpected errors.
 */
async function getAggregatedCosts(req, res) {
  try {
    const tenantId = req?.tenantId || req?.organizationId || null;

    // Fetch minimal set of fields but include fallbacks; schema is strict:false so extra fields may exist.
    const [rawUsers, rawProjects] = await Promise.all([
      // Try to include typical identity fields if they exist; relying on permissive model
      User.find(tenantId ? { tenant_id: String(tenantId) } : {}, { name: 1, email: 1, user_cost: 1, organization_name: 1, tenant_id: 1 }).lean(),
      Project.find(tenantId ? { tenant_id: String(tenantId) } : {}, { project_name: 1, name: 1, project_cost: 1, owner_user_id: 1, ownerUserId: 1, project_id: 1, tenant_id: 1 }).lean(),
    ]);

    const users = (rawUsers || []).map((u) => {
      const user_cost = toNumber(u?.user_cost || 0);
      // keep common identity fields if present
      const name = u?.name || u?.user_name || u?.full_name || null;
      const email = u?.email || u?.user_email || null;
      return {
        ...u,
        name,
        email,
        user_cost,
      };
    });

    const projects = (rawProjects || []).map((p) => {
      const project_cost = toNumber(p?.project_cost || 0);
      const ownerUserId = p?.ownerUserId ?? p?.owner_user_id ?? null;
      const name = p?.project_name || p?.name || p?.project_id || null;
      return {
        ...p,
        name,
        ownerUserId,
        project_cost,
      };
    });

    return res.status(200).json({ users, projects });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/llm-costs failed:', err?.message || err);
    return res.status(500).json({ message: err?.message || 'Failed to fetch aggregated LLM costs' });
  }
}

module.exports = {
  getAggregatedCosts,
};