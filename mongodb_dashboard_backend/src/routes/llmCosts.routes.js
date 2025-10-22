const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();
// Default sort by most recent cost first
const controller = buildCrudController(LLMCost, '-timestamp');

// Usage-over-time aggregation controller
const { usageOverTime } = require('../controllers/llmCosts.usage.controller');

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
 * /api/llm-costs/usage-over-time:
 *   get:
 *     summary: LLM model usage over time (stacked by model)
 *     description: |
 *       Aggregates llm_costs by day and llm_model for the last N days (default 30, max 180), summing total_cost.
 *       Returns a normalized time series suitable for stacked area chart rendering.
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 180
 *           default: 30
 *         description: Number of days to include, counting back from today.
 *     responses:
 *       200:
 *         description: Aggregated usage series
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         description: YYYY-MM-DD
 *                       series:
 *                         type: object
 *                         additionalProperties:
 *                           type: number
 *                 meta:
 *                   type: object
 *                   properties:
 *                     models:
 *                       type: array
 *                       items: { type: string }
 *                     start:
 *                       type: string
 *                       format: date-time
 *                     end:
 *                       type: string
 *                       format: date-time
 *                     days:
 *                       type: integer
 *       400:
 *         description: Invalid days parameter
 *       500:
 *         description: Internal server error
 */
// PUBLIC_INTERFACE
router.get('/usage-over-time', asyncHandler(usageOverTime));

/**
 * @swagger
 * /api/llm-costs/{id}:
 *   get:
 *     summary: Get an LLM cost record by ID
 *     tags: [LLMCosts]
 *     parameters:
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
