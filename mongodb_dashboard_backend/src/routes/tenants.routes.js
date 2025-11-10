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
 * PUBLIC_INTERFACE
 * GET /api/tenants/:tenantId/navigation
 * Guard rails ensure :tenantId matches token tenant unless admin RBAC allows otherwise.
 */
router.get(
  '/:tenantId/navigation',
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    const roles = req.auth?.roles || [];
    const isAdmin = roles.includes('admin') || roles.includes('superadmin') || roles.includes('tenant:read:all');
    if (!isAdmin && req?.auth?.tenantId && req.auth.tenantId !== tenantId) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }
    const tenant = await Tenant.findOne({ tenant_id: tenantId }).lean();
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

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

module.exports = router;
