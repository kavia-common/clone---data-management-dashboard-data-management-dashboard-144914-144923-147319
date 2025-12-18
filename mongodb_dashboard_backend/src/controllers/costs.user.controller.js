'use strict';

const { success, handleError } = require('../utils/http');
const { getUserCosts } = require('../services/userCosts.service');

/**
 * PUBLIC_INTERFACE
 * getUserTotalCost
 * Controller for GET /api/costs/user/total
 *
 * Computes total LLM cost for a single user within the active tenant scope.
 * - Enforces tenant scoping consistent with Costs module rules:
 *   • When Authorization/JWT is used and a tenant is present in req.auth/req.tenantId, that tenant is enforced.
 *   • In demo/test mode without JWT, x-organization-id header or ?tenant_id/?organization_id may be used upstream
 *     to set req.tenantId via middleware. This controller uses the resolved req.tenantId but does not accept tenant in the filter.
 * - Normalizes user_id comparison as string (matches $toString in aggregation).
 *
 * Query parameters:
 * - user_id: string (required) – the selected user's identifier
 * - page, limit, sort, filter: optional; preserved for compatibility even if unused in total aggregation
 *
 * Returns:
 *  {
 *    success: true,
 *    data: {
 *      userId: "<id>",
 *      total_cost: <number>,
 *      user_cost: <number>, // alias of total_cost
 *      currency: "USD",
 *      by_agent: [{ agent_name, total_cost }],
 *      by_type: [{ type, total_cost }]
 *    },
 *    meta: {
 *      tenant_id: "<resolved-tenant-id>" | null,
 *      page, limit, sort
 *    }
 *  }
 */
async function getUserTotalCost(req, res) {
  try {
    const tenantId = req?.tenantId || req?.organizationId || null;

    // Basic validation
    const userId = (req.query.user_id || req.query.userId || '').toString().trim();
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing required query parameter: user_id' });
    }

    // Optionally parse pagination/sorting from query to keep parity with Costs UI expectations
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 200);
    const sort = req.query.sort || null;

    // Use shared aggregation service which normalizes fields and computes totals/breakdowns
    const userCosts = await getUserCosts(userId, req);

    // Set minimal diagnostics headers
    try {
      res.setHeader('x-effective-tenant', tenantId ? String(tenantId) : '');
      res.setHeader('x-user-id', userId);
    } catch (_) {}

    return success(
      res,
      userCosts,
      {
        tenant_id: tenantId ? String(tenantId) : null,
        page,
        limit,
        sort,
      },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = {
  getUserTotalCost,
};
