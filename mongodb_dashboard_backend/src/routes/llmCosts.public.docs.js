/**
 * This file provides Swagger docs and public routes for listing LLM cost records,
 * including a public summary endpoint that aggregates user_cost and project_cost based on `type`.
 */
const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();
const controller = buildCrudController(LLMCost, '-timestamp');

/**
 * @swagger
 * /api/llm-costs:
 *   get:
 *     summary: List all LLM cost records
 *     description: >
 *       Returns all documents from the llm_costs collection without requiring any filters.
 *       If explicit pagination (page/limit) is provided, response is wrapped with { success, data, meta }.
 *       Otherwise a raw array is returned. All fields present in the database are returned (no projection).
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *         description: Optional page number to enable envelope response
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *         description: Optional page size to enable envelope response
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *         description: Optional sort string (e.g., -timestamp or total_cost)
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
 *       500:
 *         description: Internal server error
 */
// PUBLIC_INTERFACE
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Ensure we are listing everything: clear any filter coming from client
    req.query.filter = '{}';
    return controller.list(req, res);
  })
);

/**
 * @swagger
 * /api/llm-costs/summary:
 *   get:
 *     summary: LLM costs summary (user_cost and project_cost)
 *     description: >
 *       Aggregates costs by the existing 'type' field to produce user_cost and project_cost totals.
 *       - If type === 'user' the cost contributes to user_cost.
 *       - If type === 'project' the cost contributes to project_cost.
 *       Returns non-zero values when data exists.
 *     tags: [LLMCosts]
 *     responses:
 *       200:
 *         description: Summary totals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_cost: { type: number }
 *                 project_cost: { type: number }
 *                 currency: { type: string }
 */
// PUBLIC_INTERFACE
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const pipeline = [
      {
        $project: {
          type: { $ifNull: ['$type', { $ifNull: ['$service_type', '$operation'] }] },
          currency: { $ifNull: ['$currency', 'USD'] },
          total_cost_num: {
            $cond: [
              { $ne: ['$total_cost', null] },
              {
                $convert: {
                  input: {
                    $cond: [
                      { $isNumber: '$total_cost' },
                      '$total_cost',
                      { $toString: '$total_cost' },
                    ],
                  },
                  to: 'double',
                  onError: 0,
                  onNull: 0,
                },
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          user_cost: { $sum: { $cond: [{ $eq: ['$type', 'user'] }, '$total_cost_num', 0] } },
          project_cost: { $sum: { $cond: [{ $eq: ['$type', 'project'] }, '$total_cost_num', 0] } },
          currencies: { $addToSet: '$currency' },
        },
      },
    ];

    let summary = { user_cost: 0, project_cost: 0, currencies: ['USD'] };
    try {
      const result = await LLMCost.aggregate(pipeline);
      summary = result?.[0] || summary;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error aggregating /api/llm-costs/summary (public)', err?.message || err);
    }

    const currency =
      Array.isArray(summary.currencies) && summary.currencies.length === 1
        ? summary.currencies[0]
        : 'USD';

    return res.status(200).json({
      user_cost: Number(summary.user_cost || 0),
      project_cost: Number(summary.project_cost || 0),
      currency,
    });
  })
);

/**
 * @swagger
 * /api/projects/{projectId}/llm-costs:
 *   get:
 *     summary: List LLM cost records (deprecated project alias)
 *     deprecated: true
 *     description: >
 *       Deprecated alias that forwards to /api/llm-costs (list-all). This path no longer applies project-based filtering.
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
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
 */
// PUBLIC_INTERFACE
router.get(
  '/projects/:projectId/llm-costs',
  asyncHandler(async (req, res) => {
    // Forward to root GET which lists all; no project-based filtering
    return router.handle({ ...req, url: '/', method: 'GET' }, res);
  })
);

module.exports = router;
