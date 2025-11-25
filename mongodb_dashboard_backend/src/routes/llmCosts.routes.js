'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * LLMCosts Router
 * Exposes CRUD endpoints with tenant enforcement.
 */
const router = express.Router();
/**
 * Use safe default sort on indexed field 'timestamp' in descending order.
 * Sorting by '-timestamp' benefits from index { tenant_id:1, timestamp:-1 } on the model.
 */
const controller = buildCrudController(LLMCost, '-timestamp'); // default indexed sort

/**
 * Resolve tenantId from JWT/header/query and enforce on queries.
 * Apply verifyAuth explicitly as a safeguard in case the router is mounted without it.
 */
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

 // Route-local super admin (T0000) bypass detector and normalization from organization_id/tenant_id
router.use((req, res, next) => {
  try {
    const qOrg = typeof req.query?.organization_id === 'string' ? req.query.organization_id.trim() : '';
    const qTenant = typeof req.query?.tenant_id === 'string' ? req.query.tenant_id.trim() : '';
    const hdr =
      (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers?.['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
      (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      '';
    const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
    const normalized = hdr || qOrg || qTenant || authTenant || '';

    const isT0000 = normalized === 'T0000';
    let bypassApplied = false;
    if (isT0000) {
      req.tenantScopeDisabled = true;
      req.allTenants = true;
      req.costsAllTenantsBypass = true;
      bypassApplied = true;
      try {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } catch (_) {}
    } else if (normalized) {
      req.organizationId = normalized;
      req.tenantId = normalized;
      try { res.set('X-Applied-Tenant', String(normalized)); } catch(_) {}
    }

    console.log('[llmCosts.routes] tenant normalization', {
      organization_id: qOrg || null,
      tenant_id: qTenant || null,
      normalizedTenant: normalized || null,
      bypassApplied,
    });
  } catch (e) {
    // non-fatal
  }
  next();
});

/**
 * Expose applied tenant for quick debugging on responses at this router scope
 * Adds both X-Applied-Tenant and x-applied-organization-id for preview verification.
 */
router.use(async (req, res, next) => {
  try {
    if (req.tenantId) {
      res.set('X-Applied-Tenant', String(req.tenantId));
      res.set('x-applied-organization-id', String(req.tenantId));
      const tenant = String(req.tenantId);
      const orgFilter = {
        $or: [
          { tenant_id: tenant },
          { organization_id: tenant },
          { orgId: tenant },
          { tenantId: tenant },
          { organizationId: tenant },
          { 'tenant.tenant_id': tenant },
        ],
      };
      res.set('X-Applied-Filter', JSON.stringify(orgFilter));
      try {
        res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
      } catch (_) {}
    }
  } catch (_) {}
  next();
});

/**
 * @swagger
 * tags:
 *   name: LLMCosts
 *   description: LLM usage cost records endpoints
 */

/**
 * @swagger
 * /api/llm-costs:
 *   get:
 *     summary: List LLM cost records
 *     description: |
 *       Returns a list of LLM cost documents. Supports optional JSON filter, sorting and pagination.
 *       If explicit pagination (page/limit) is provided, response is wrapped with { success, data, meta }.
 *       Otherwise a raw array is returned.
 *       Tenant scoping: When Authorization is present, JWT tenant is enforced and overrides header/query. If a different organization_id/tenant_id is provided than the JWT tenant, the request is rejected with 403.
 *       In demo mode without JWT, x-organization-id header or query aliases (?tenant_id/organization_id) can be used to set scope.
 *       The server ignores any tenant fields in the filter and injects the resolved tenant internally.
 *       Debug: response will include x-applied-organization-id and x-applied-tenant-filter headers for troubleshooting.
 *       Safe defaults: server sorts by '-timestamp' (indexed) to avoid large in-memory sorts; large sorts use allowDiskUse(true).
 *     tags: [LLMCosts]
 *     operationId: listLlmCosts
 *     parameters:
 *       - $ref: '#/components/parameters/xOrganizationId'
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *         description: Optional tenant (alias). Alternative to header; ignored if header is provided. Payload.tenant_id will be overridden by resolved tenant.
 *       - in: query
 *         name: tenant_id
 *         schema:
 *           type: string
 *         description: Optional tenant. Alternative to header; ignored if header is provided. Payload.tenant_id will be overridden by resolved tenant.
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Optional page number to enable envelope response
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *         description: Optional page size to enable envelope response
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *         description: Sort string (whitelist: timestamp, created_at, _id). Default -timestamp.
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *         description: JSON filter (e.g., {"tenant_id":"org1","llm_model":"gpt-4o"})
 *     responses:
 *       200:
 *         description: Successful response (array or envelope based on pagination params)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   items:
 *                     $ref: '#/components/schemas/GenericDocument'
 *                 - $ref: '#/components/schemas/ListEnvelope'
 *       400:
 *         description: Missing tenant (x-organization-id) or invalid filter
 */
router.get('/', asyncHandler(controller.list));

/**
 * @swagger
 * /api/llm-costs/{id}:
 *   get:
 *     summary: Get an LLM cost record by ID
 *     tags: [LLMCosts]
 *     operationId: getLlmCostById
 *     parameters:
 *       - $ref: '#/components/parameters/xOrganizationId'
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: query
 *         name: tenant_id
 *         schema:
 *           type: string
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: OK
 *       404:
 *         description: Not found
 *       400:
 *         description: Invalid id
 *       403:
 *         description: Missing or invalid tenant header (x-organization-id)
 */
router.get('/:id', asyncHandler(controller.getById));

/**
 * @swagger
 * /api/llm-costs:
 *   post:
 *     summary: Create LLM cost record
 *     operationId: createLlmCost
 *     description: |
 *       Creates a new LLM cost record scoped to the tenant resolved from `x-organization-id`.
 *       Client may include `tenant_id` in payload based on user login, but it will be overridden by the resolved tenant.
 *     tags: [LLMCosts]
 *     parameters:
 *       - $ref: '#/components/parameters/xOrganizationId'
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *         description: Optional alternative to header; ignored if header is provided. Payload tenant fields are overridden.
 *       - in: query
 *         name: tenant_id
 *         schema:
 *           type: string
 *         description: Optional alternative to header; ignored if header is provided. Payload tenant fields are overridden.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *           example:
 *             tenant_id: org_123
 *             llm_model: gpt-4o
 *             total_cost: 0.23
 *     responses:
 *       201:
 *         description: Created
 *       422:
 *         description: Validation failed
 *       400:
 *         description: Missing tenant (x-organization-id) or bad request
 */
router.post('/', asyncHandler(controller.create));

/**
 * @swagger
 * /api/llm-costs/{id}:
 *   put:
 *     summary: Update LLM cost record
 *     operationId: updateLlmCost
 *     description: |
 *       Updates an LLM cost record. Server enforces tenant scoping from `x-organization-id`.
 *       Client may include tenant fields in payload, but they are overridden by the resolved tenant.
 *     tags: [LLMCosts]
 *     parameters:
 *       - $ref: '#/components/parameters/xOrganizationId'
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: query
 *         name: tenant_id
 *         schema:
 *           type: string
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 *       400:
 *         description: Invalid id or payload
 *       422:
 *         description: Validation failed
 */
router.put('/:id', asyncHandler(controller.update));

/**
 * @swagger
 * /api/llm-costs/{id}:
 *   delete:
 *     summary: Delete LLM cost record
 *     operationId: deleteLlmCost
 *     tags: [LLMCosts]
 *     parameters:
 *       - $ref: '#/components/parameters/xOrganizationId'
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: query
 *         name: tenant_id
 *         schema:
 *           type: string
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 *       400:
 *         description: Invalid id
 */
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
