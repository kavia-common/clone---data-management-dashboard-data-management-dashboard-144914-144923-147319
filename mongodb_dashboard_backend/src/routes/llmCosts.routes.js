const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();
// Default sort by most recent cost first
const controller = buildCrudController(LLMCost, '-timestamp');

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
 * PUBLIC_INTERFACE
 * GET /api/llm-costs/summary
 * Aggregates costs by the existing 'type' field to produce user_cost and project_cost totals.
 * - If type === 'user' the cost contributes to user_cost.
 * - If type === 'project' the cost contributes to project_cost.
 * - Returns non-zero values where data exists.
 *
 * Response:
 *  {
 *    user_cost: number,
 *    project_cost: number,
 *    currency: string
 *  }
 */
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    // Normalize and sum total_cost per doc
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
          user_cost: {
            $sum: {
              $cond: [{ $eq: ['$type', 'user'] }, '$total_cost_num', 0],
            },
          },
          project_cost: {
            $sum: {
              $cond: [{ $eq: ['$type', 'project'] }, '$total_cost_num', 0],
            },
          },
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
      console.error('Error aggregating /api/llm-costs/summary', err?.message || err);
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
