'use strict';

const express = require('express');
const { getOrganizationUserCosts } = require('../controllers/costs.byOrganization.controller');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');

const router = express.Router();

// PUBLIC_INTERFACE
// GET /api/costs/:organization_id
// Fetch organization/user aggregated costs with counts using llm_costs collection
router.use(requireTenant, tenantScopeEnforcer());

/**
 * @swagger
 * /api/costs/{organization_id}:
 *   get:
 *     summary: Organization/user LLM costs aggregate
 *     description: |
 *       Aggregates records from the llm_costs collection by organization and user.
 *       Returns a flat list with fields: organization_id, organization_name, organization_cost, users (count of users with projects),
 *       user_id, type, user_cost, projects (count of projects for the user).
 *       Requires tenant scoping; header x-organization-id or JWT must align with path organization_id.
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: path
 *         name: organization_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Tenant (organization) identifier
 *     responses:
 *       200:
 *         description: Aggregated costs
 *       400:
 *         description: Missing organization_id
 *       403:
 *         description: Forbidden - tenant scope mismatch
 *       500:
 *         description: Internal server error
 */
router.get('/:organization_id', getOrganizationUserCosts);

module.exports = router;
