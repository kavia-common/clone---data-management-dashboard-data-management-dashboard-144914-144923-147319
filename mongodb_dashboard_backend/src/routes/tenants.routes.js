'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const Tenant = require('../models/tenant.model');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { ensureTenantAccess } = require('../middleware/authTenant');

const router = express.Router();

// Enforce auth+tenant for all routes in this router
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
  ensureTenantAccess,
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;

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

/**
 * PUBLIC_INTERFACE
 * GET /api/tenants/:tenantId/credits-summary
 * Placeholder guarded route (controller/service may be added later).
 */
router.get(
  '/:tenantId/credits-summary',
  ensureTenantAccess,
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    const tenant = await Tenant.findOne({ tenant_id: tenantId }).lean();
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    // If there is a service/controller to compute credits summary, call it here.
    // For now, return minimal structure to avoid 404 in client lookups.
    return res.status(200).json({
      tenant_id: tenant.tenant_id,
      tenant_name: tenant.tenant_name,
      credits: {
        allocated: tenant.credits_allocated ?? null,
        used: tenant.credits_used ?? null,
        balance: tenant.credits_balance ?? null,
      },
    });
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/tenants/:tenantId/users/usage
 * Placeholder guarded route (controller/service may be added later).
 */
router.get(
  '/:tenantId/users/usage',
  ensureTenantAccess,
  asyncHandler(async (req, res) => {
    const { tenantId } = req.params;
    const tenant = await Tenant.findOne({ tenant_id: tenantId }).lean();
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    // If there is an analytics service for users usage by tenant, call it here.
    // Minimal response to satisfy route presence.
    return res.status(200).json({
      tenant_id: tenant.tenant_id,
      users: [],
      total_users: 0,
    });
  })
);

module.exports = router;
