const express = require('express');
const { asyncHandler } = require('../utils/http');
const AppDeployment = require('../models/appDeployments.model');
const { buildCrudController } = require('../controllers/crudFactory');
const { validateAppDeployment } = require('../middleware/validators');
const { enrichDeployment } = require('../services/enrichment.util');
const { resolveProjectNames, resolveProjectName } = require('../services/projects.service');

const router = express.Router();
const controller = buildCrudController(AppDeployment, '-created_at');

// Helper: safely enrich a single deployment doc
async function enrichOne(doc) {
  try {
    if (!doc || typeof doc !== 'object') return doc;

    // compute normalized projectId and updatedAt
    const { projectId, updatedAt } = enrichDeployment(doc);

    // resolve project name
    let projectName = null;
    try {
      if (projectId) {
        projectName = await resolveProjectName(projectId);
      }
    } catch {
      projectName = null;
    }

    // Attach enriched fields without removing originals
    return {
      ...doc,
      projectId: projectId ?? null,
      projectName: projectName ?? null,
      updatedAt: updatedAt ? new Date(updatedAt) : null,
    };
  } catch {
    // On any unexpected error, return original doc
    return doc;
  }
}

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
router.get(
  '/',
  asyncHandler(async (req, res, next) => {
    // Intercept the response from controller.list by calling underlying logic here:
    // We reuse the list logic indirectly by calling the model operations similarly to crudFactory
    // but to avoid duplicating logic, we'll call controller.list and then enrich the outgoing payload
    // by monkey-patching res.json temporarily.

    const originalJson = res.json.bind(res);

    res.json = async (payload) => {
      try {
        // payload can be either:
        // - raw array (no explicit pagination)
        // - envelope: { success, data: [...], meta }
        if (Array.isArray(payload)) {
          const rawItems = payload;
          // Collect normalized projectIds for bulk name resolution
          const normalizedIds = rawItems
            .map((d) => enrichDeployment(d).projectId)
            .filter((v) => v);
          let nameMap = new Map();
          try {
            nameMap = await resolveProjectNames(normalizedIds);
          } catch {
            nameMap = new Map();
          }

          const enriched = rawItems.map((doc) => {
            try {
              const { projectId, updatedAt } = enrichDeployment(doc);
              const projectName = projectId ? nameMap.get(projectId) ?? null : null;
              return {
                ...doc,
                projectId: projectId ?? null,
                projectName,
                updatedAt: updatedAt ? new Date(updatedAt) : null,
              };
            } catch {
              return doc;
            }
          });

          return originalJson(enriched);
        }

        // Envelope case
        if (payload && typeof payload === 'object' && Array.isArray(payload.data)) {
          const items = payload.data;

          const normalizedIds = items
            .map((d) => enrichDeployment(d).projectId)
            .filter((v) => v);
          let nameMap = new Map();
          try {
            nameMap = await resolveProjectNames(normalizedIds);
          } catch {
            nameMap = new Map();
          }

          const enrichedItems = items.map((doc) => {
            try {
              const { projectId, updatedAt } = enrichDeployment(doc);
              const projectName = projectId ? nameMap.get(projectId) ?? null : null;
              return {
                ...doc,
                projectId: projectId ?? null,
                projectName,
                updatedAt: updatedAt ? new Date(updatedAt) : null,
              };
            } catch {
              return doc;
            }
          });

          return originalJson({ ...payload, data: enrichedItems });
        }

        // Unknown shape: return as-is
        return originalJson(payload);
      } catch {
        // On enrichment failure, fall back to original payload
        return originalJson(payload);
      }
    };

    // Delegate to the original list controller
    return controller.list(req, res, next);
  })
);

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
router.get(
  '/:id',
  asyncHandler(async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = async (payload) => {
      try {
        // payload for getById is a raw document
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const enriched = await enrichOne(payload);
          return originalJson(enriched);
        }
        return originalJson(payload);
      } catch {
        return originalJson(payload);
      }
    };

    return controller.getById(req, res, next);
  })
);

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
