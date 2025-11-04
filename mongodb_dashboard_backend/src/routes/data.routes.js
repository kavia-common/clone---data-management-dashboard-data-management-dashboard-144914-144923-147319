const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const Sample = require('../models/sample.model');

const router = express.Router();
const controller = buildCrudController(Sample, '-created_at');

/**
 * @swagger
 * tags:
 *   name: SampleData
 *   description: Sample data endpoints for demonstration
 */

/**
 * @swagger
 * /api/data:
 *   get:
 *     summary: Fetch sample data
 *     description: >
 *       Returns documents from the "sample" MongoDB collection. Supports optional JSON filtering,
 *       sorting and pagination. If no explicit pagination is provided, returns a raw array.
 *     tags: [SampleData]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *         description: Page number (enables envelope response when provided)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *         description: Page size (enables envelope response when provided)
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *         description: Sort string (e.g., -created_at)
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *         description: JSON string filter (e.g., {"name":"demo"})

 *     responses:
 *       200:
 *         description: List of sample documents (array or envelope based on pagination params)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   items: { $ref: '#/components/schemas/GenericDocument' }
 *                 - $ref: '#/components/schemas/ListEnvelope'
 *       400:
 *         description: Invalid filter JSON
 */
router.get('/', asyncHandler(controller.list));

module.exports = router;
