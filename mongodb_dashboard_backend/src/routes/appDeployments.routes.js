const express = require('express');
const { asyncHandler } = require('../utils/http');
const AppDeployment = require('../models/appDeployments.model');
const { buildCrudController } = require('../controllers/crudFactory');
const { validateAppDeployment } = require('../middleware/validators');

const router = express.Router();
const controller = buildCrudController(AppDeployment, '-created_at');

/**
 * @swagger
 * tags:
 *   name: AppDeployments
 *   description: Application deployments endpoints
 */

/**
 * @swagger
 * /api/app-deployments:
 *   get:
 *     summary: List application deployments
 *     description: Paginated list with optional filter and sort.
 *     tags: [AppDeployments]
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
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *         description: JSON filter (e.g., {"project_id":"p1","status":"success"})
 *     responses:
 *       200:
 *         description: OK (array or envelope based on pagination params)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   items: { $ref: '#/components/schemas/GenericDocument' }
 *                 - $ref: '#/components/schemas/ListEnvelope'
 *       400: { description: Invalid filter }
 */
router.get('/', asyncHandler(controller.list));

/**
 * @swagger
 * /api/app-deployments/{id}:
 *   get:
 *     summary: Get app deployment by ID
 *     tags: [AppDeployments]
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
 * /api/app-deployments:
 *   post:
 *     summary: Create app deployment
 *     tags: [AppDeployments]
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
router.post('/', validateAppDeployment, asyncHandler(controller.create));

/**
 * @swagger
 * /api/app-deployments/{id}:
 *   put:
 *     summary: Update app deployment
 *     tags: [AppDeployments]
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
router.put('/:id', validateAppDeployment, asyncHandler(controller.update));

/**
 * @swagger
 * /api/app-deployments/{id}:
 *   delete:
 *     summary: Delete app deployment
 *     tags: [AppDeployments]
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
