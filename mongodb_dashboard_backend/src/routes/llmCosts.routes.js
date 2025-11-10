'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * LLMCosts Router
 * Exposes CRUD endpoints with tenant enforcement.
 */
const router = express.Router();
// Default sort by most recent cost first
const controller = buildCrudController(LLMCost, '-timestamp');

// Resolve tenantId from header/query/payload (organization_id alias) and enforce on queries
router.use(requireTenant, tenantScopeEnforcer());



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
 *     description: >
 *       Returns a list of LLM cost documents. Supports optional JSON filter, sorting and pagination.
 *       If explicit pagination (page/limit) is provided, response is wrapped with { success, data, meta }.
 *       Otherwise a raw array is returned.
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: header
 *         name: x-organization-id
 *         required: true
 *         schema: { type: string }
 *         description: Required organization (tenant) id; takes precedence over query (?tenant_id or ?organization_id). Server enforces tenant scoping regardless of client-provided filters and overrides payload.tenant_id/organization_id.
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *         description: Optional tenant (alias). Alternative to header; ignored if header is provided. Payload.tenant_id will be overridden by resolved tenant.
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *         description: Optional tenant. Alternative to header; ignored if header is provided. Payload.tenant_id will be overridden by resolved tenant.
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *         description: Sort string (e.g., -timestamp or total_cost)
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *         description: JSON filter (e.g., {"tenant_id":"org1","llm_model":"gpt-4o"})
 *     responses:
 *       200:
 *         description: Successful response (array or envelope based on pagination params)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   items: { $ref: '#/components/schemas/GenericDocument' }
 *                 - $ref: '#/components/schemas/ListEnvelope'
 *       400:
 *         description: Invalid filter
 */
router.get('/', asyncHandler(controller.list));



/**
 * @swagger
 * /api/llm-costs/{id}:
 *   get:
 *     summary: Get an LLM cost record by ID
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: header
 *         name: x-organization-id
 *         required: true
 *         schema: { type: string }
 *         description: Required organization (tenant) id; takes precedence over query (?tenant_id or ?organization_id). The server overrides payload.tenant_id/organization_id with the resolved tenant.
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 *       400: { description: Invalid id }
 */
router.get('/:id', asyncHandler(controller.getById));

/**
 * @swagger
 * /api/llm-costs:
 *   post:
 *     summary: Create LLM cost record
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: header
 *         name: x-organization-id
 *         required: true
 *         schema: { type: string }
 *         description: Required organization (tenant) id; takes precedence over query (?tenant_id or ?organization_id). The server overrides payload.tenant_id/organization_id with the resolved tenant.
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *         description: Optional alternative to header; ignored if header is provided. Payload tenant fields are overridden.
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *         description: Optional alternative to header; ignored if header is provided. Payload tenant fields are overridden.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       201: { description: Created }
 *       422: { description: Validation failed }
 *       400: { description: Bad request }
 */
router.post('/', asyncHandler(controller.create));

/**
 * @swagger
 * /api/llm-costs/{id}:
 *   put:
 *     summary: Update LLM cost record
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: header
 *         name: x-organization-id
 *         required: true
 *         schema: { type: string }
 *         description: Required organization (tenant) id; takes precedence over query (?tenant_id or ?organization_id). Server enforces tenant scoping and overrides any payload tenant fields.
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *       400: { description: Invalid id or payload }
 *       422: { description: Validation failed }
 */
router.put('/:id', asyncHandler(controller.update));

/**
 * @swagger
 * /api/llm-costs/{id}:
 *   delete:
 *     summary: Delete LLM cost record
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: header
 *         name: x-organization-id
 *         required: true
 *         schema: { type: string }
 *         description: Required organization (tenant) id; takes precedence over query (?tenant_id or ?organization_id). Server enforces tenant scoping on delete.
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *         description: Optional alternative to header; ignored if header is provided.
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: Not found }
 *       400: { description: Invalid id }
 */
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
