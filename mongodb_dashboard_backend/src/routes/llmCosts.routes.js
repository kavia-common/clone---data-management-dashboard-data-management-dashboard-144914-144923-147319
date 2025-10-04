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
/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Supports optional filters: projectId (string), from (ISO date-time), to (ISO date-time)
 * Falls back to generic list behavior if no specific filters are provided.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Extend generic list with projectId + date range filtering.
    const filter = {};

    // projectId filter support (maps to project_id in db)
    const { projectId, from, to } = req.query;
    if (projectId) {
      filter.project_id = projectId.toString();
    }

    // Prefer timestamp; if collection uses createdAt/ts in some docs, they will still be returned
    // since we do not omit fields; here we filter only when timestamp exists.
    if (from || to) {
      const range = {};
      if (from) {
        const d = new Date(from);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid from date' });
        }
        range.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid to date' });
        }
        range.$lte = d;
      }
      filter.timestamp = range;
    }

    // Inject composed filter via existing generic list flow using req.query.filter
    const originalFilter = req.query.filter;
    try {
      const merged =
        originalFilter && typeof originalFilter === 'string'
          ? { ...JSON.parse(originalFilter), ...filter }
          : { ...(originalFilter || {}), ...filter };

      req.query.filter = JSON.stringify(merged);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }

    // Defer to generic list to respect pagination/envelope and sort behaviors
    return controller.list(req, res);
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
/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/llm-costs
 * Reuses logic from GET /api/llm-costs with projectId pre-applied from path param.
 */
router.get(
  '/projects/:projectId/llm-costs',
  asyncHandler(async (req, res) => {
    // Map path param into query for unified handling
    req.query.projectId = req.params.projectId;
    return router.handle({ ...req, url: '/', method: 'GET' }, res);
  })
);

/**
 * Keep the record-by-id route after custom routes
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/llm-costs
 * Reuses logic from GET /api/llm-costs with projectId pre-applied from path param.
 */
router.get(
  '/projects/:projectId/llm-costs',
  asyncHandler(async (req, res) => {
    // Map path param into query for unified handling
    req.query.projectId = req.params.projectId;
    return router.handle({ ...req, url: '/', method: 'GET' }, res);
  })
);

/**
 * Keep the record-by-id route after custom routes
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
/**
 * @swagger
 * /api/projects/{projectId}/llm-costs:
 *   get:
 *     summary: List LLM cost records for a project
 *     description: Returns LLM cost documents filtered by projectId. Supports optional from/to date range and pagination.
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: sort
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
 *       400: { description: Invalid input }
 *       500: { description: Internal server error }
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
