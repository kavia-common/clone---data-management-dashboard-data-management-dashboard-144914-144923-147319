const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const Tenant = require('../models/tenant.model');
const { getSessionDurations, getCosts } = require('../services/analytics');
const { usdToCredits } = require('../utils/credits');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

const router = express.Router();
// enforce auth+tenant for all routes in this router
router.use(verifyAuth, requireTenant);
const controller = buildCrudController(Tenant, '-created_at');

/**
 * @swagger
 * tags:
 *   name: Tenants
 *   description: Tenant (organization) endpoints with hierarchy and usage aggregations
 */

// Basic CRUD list/create/get/update/delete
router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

/**
 * @swagger
 * /api/tenants/{tenantId}/navigation:
 *   get:
 *     summary: Get tenant navigation structure (groups, users, projects)
 *     description: Returns hierarchy/grouping data for navigation and group-wise access for a tenant.
 *     tags: [Tenants]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Navigation structure for tenant
 *       404:
 *         description: Tenant not found
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/tenants/:tenantId/navigation
 * Returns hierarchy/grouping data for navigation and group-wise access.
 */
router.get(
  '/:tenantId/navigation',
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    // Enforce path param matches authenticated tenant unless RBAC expanded later
    if (req?.auth?.tenantId && req.auth.tenantId !== tenantId) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }
    const tenant = await Tenant.findOne({ tenant_id: tenantId }).lean();
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    // Shape navigation info
    const groups = (tenant.groups || []).map((g) => ({ group: g }));
    const users = (tenant.users || []).map((u) => ({
      user_id: u.user_id,
      role: u.role,
      groups: u.groups || [],
    }));
    const projects = (tenant.projects || []).map((p) => ({ project_id: p }));

    return res.status(200).json({
      tenant_id: tenant.tenant_id,
      tenant_name: tenant.tenant_name,
      groups,
      users,
      projects,
    });
  })
);

/**
 * @swagger
 * /api/tenants/{tenantId}/credits-summary:
 *   get:
 *     summary: Tenant credit summary
 *     description: Returns tenant-level allocated credits, usage (from LLM costs), and balance with breakdowns.
 *     tags: [Tenants]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Credit summary with breakdown by user and project
 *       404:
 *         description: Tenant not found
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/tenants/:tenantId/credits-summary
 * Returns tenant credit allocation and actual usage (costs) + balance.
 */
router.get(
  '/:tenantId/credits-summary',
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    if (req?.auth?.tenantId && req.auth.tenantId !== tenantId) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }
    const tenant = await Tenant.findOne({ tenant_id: tenantId }).lean();
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

    const costs = await getCosts({ tenant_id: tenantId });

    // Treat allocated_credits as credits (organization-level quota).
    const allocated = Number(tenant.allocated_credits || 0);
    // Convert usage (USD) to credits for consistency across the app
    const usedCredits = usdToCredits(Number(costs.total_cost || 0));
    const balance = allocated - usedCredits;

    // Convert breakdown aggregates (USD) to credits too
    const byUserCredits = Object.fromEntries(
      Object.entries(costs.cost_by_user || {}).map(([k, v]) => [k, usdToCredits(Number(v || 0))])
    );
    const byProjectCredits = Object.fromEntries(
      Object.entries(costs.cost_by_project || {}).map(([k, v]) => [k, usdToCredits(Number(v || 0))])
    );

    return res.status(200).json({
      tenant_id: tenant.tenant_id,
      credits_unit: 'credits',
      allocated_credits: allocated,
      used_credits: usedCredits,
      balance_credits: balance,
      breakdown: {
        by_user: byUserCredits,
        by_project: byProjectCredits,
      },
    });
  })
);

/**
 * @swagger
 * /api/tenants/{tenantId}/users/usage:
 *   get:
 *     summary: Tenant users usage
 *     description: Returns per-user total cost and total minutes for the specified tenant.
 *     tags: [Tenants]
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Users usage summary
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/tenants/:tenantId/users/usage
 * Drill-down per user: credit consumption and time spent grouped by project.
 */
router.get(
  '/:tenantId/users/usage',
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    if (req?.auth?.tenantId && req.auth.tenantId !== tenantId) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }

    // Costs and durations by user
    const [costs, durations] = await Promise.all([
      getCosts({ tenant_id: tenantId }),
      getSessionDurations({ tenant_id: tenantId }),
    ]);

    // Build user-centric aggregation
    const user_ids = new Set([
      ...Object.keys(costs.cost_by_user || {}),
      ...Object.keys(durations.minutes_by_user || {}),
    ]);

    const users = Array.from(user_ids).map((uid) => ({
      user_id: uid,
      total_cost: Number(costs.cost_by_user[uid] || 0),
      total_minutes: Number(durations.minutes_by_user[uid] || 0),
    }));

    return res.status(200).json({
      tenant_id: tenantId,
      users,
    });
  })
);

module.exports = router;
