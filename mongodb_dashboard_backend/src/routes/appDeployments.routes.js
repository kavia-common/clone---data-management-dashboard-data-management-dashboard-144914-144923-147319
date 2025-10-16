const express = require('express');
const { asyncHandler } = require('../utils/http');
const AppDeployment = require('../models/appDeployments.model');
const { buildCrudController } = require('../controllers/crudFactory');
const { validateAppDeployment } = require('../middleware/validators');
const { normalizeProjectId } = require('../services/enrichment.util');

const router = express.Router();
const controller = buildCrudController(AppDeployment, '-created_at');

/**
 * Lightweight in-memory cache for projectId -> projectName lookups.
 * TTL: 5 minutes. Cache is module-scoped (per-process) and non-persistent.
 * The cache is invalidated on app-deployments create/update/delete by
 * removing entries for projectIds mentioned in request payloads, or
 * inferred from affected records when possible.
 */
const PROJECT_NAME_TTL_MS = 5 * 60 * 1000; // 5 minutes
const projectNameCache = new Map(); // key: normalized projectId (string) => { projectName, expiresAt:number }

/**
 * Get a cache entry by normalized projectId if not expired.
 */
function cacheGet(pid) {
  const entry = projectNameCache.get(pid);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    projectNameCache.delete(pid);
    return null;
  }
  return entry.projectName;
}

/**
 * Set a cache entry for normalized projectId.
 */
function cacheSet(pid, projectName) {
  projectNameCache.set(pid, {
    projectName: projectName == null ? null : String(projectName),
    expiresAt: Date.now() + PROJECT_NAME_TTL_MS,
  });
}

/**
 * Attempt to extract a projectId from various payload shapes and normalize it.
 * Returns null if none found.
 */
function extractNormalizedProjectId(payload) {
  const candidate =
    payload?.projectId ??
    payload?.project_id ??
    payload?.metadata?.projectId ??
    payload?.project?.id ??
    null;

  const normalized = normalizeProjectId(candidate) || (candidate != null ? String(candidate).trim() : '');
  return normalized || null;
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
  asyncHandler(async (req, res) => {
    // Ensure explicit envelope when limit is provided without page
    if (!Object.prototype.hasOwnProperty.call(req.query, 'page') &&
        Object.prototype.hasOwnProperty.call(req.query, 'limit') &&
        !req.query.page) {
      req.query.page = '1';
    }
    return controller.list(req, res);
  })
);

/**
 * @swagger
 * /api/app-deployments/project/{projectId}/name:
 *   get:
 *     summary: Resolve projectName from App Deployments by projectId
 *     description: |
 *       Looks up App Deployments collection as the primary source to resolve a project's friendly name.
 *       Matches the provided projectId against any of: projectId, project_id, metadata.projectId, project.id.
 *       Returns 200 with { projectId, projectName } even if projectName is not found (null).
 *     tags: [AppDeployments]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema:
 *           type: string
 *           description: Project identifier to resolve
 *     responses:
 *       200:
 *         description: Resolved or null projectName from App Deployments
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projectId:
 *                   type: string
 *                   description: Normalized project id
 *                 projectName:
 *                   type: string
 *                   nullable: true
 *                   description: Resolved project name or null if not found
 */
router.get(
  '/project/:projectId/name',
  asyncHandler(async (req, res) => {
    const originalId = req.params.projectId;
    const pid = normalizeProjectId(originalId) || String(originalId || '').trim();

    if (!pid) {
      // Keep response shape intact
      return res.status(200).json({ projectId: originalId || '', projectName: null });
    }

    // Cache check: return cached value if present and not expired
    // TTL behavior: entries expire after 5 minutes; stale entries are purged on access.
    const cached = cacheGet(pid);
    if (cached !== null && cached !== undefined) {
      return res.status(200).json({ projectId: pid, projectName: cached });
    }

    // Build OR query across possible id fields in deployments
    const idQuery = {
      $or: [
        { projectId: pid },
        { project_id: pid },
        { 'metadata.projectId': pid },
        { 'project.id': pid },
      ],
    };

    // Project only known name fields
    const projection = {
      projectName: 1,
      project_name: 1,
      'metadata.projectName': 1,
      'project.name': 1,
      updatedAt: 1,
      updated_at: 1,
      createdAt: 1,
      created_at: 1,
    };

    // Prefer the latest record if multiple exist (fallback across common timestamp fields)
    const dep = await AppDeployment.findOne(idQuery, projection)
      .sort({ updatedAt: -1, updated_at: -1, createdAt: -1, created_at: -1 })
      .lean();

    const name =
      dep?.projectName ||
      dep?.project_name ||
      dep?.metadata?.projectName ||
      dep?.project?.name ||
      null;

    // Populate cache only after successful resolution attempt (even if null)
    cacheSet(pid, name);

    return res.status(200).json({ projectId: pid, projectName: name ? String(name) : null });
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
router.post(
  '/',
  validateAppDeployment,
  asyncHandler(async (req, res) => {
    // Invalidation note:
    // We proactively invalidate cache entries for any projectId found in the incoming payload
    // because a create may introduce a new projectName or update known fields.
    const pid = extractNormalizedProjectId(req.body);
    if (pid) {
      projectNameCache.delete(pid);
    }

    // Delegate to existing controller (do not change response shape)
    return controller.create(req, res);
  })
);

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
router.put(
  '/:id',
  validateAppDeployment,
  asyncHandler(async (req, res) => {
    // Invalidate for projectId present in payload
    const pidFromBody = extractNormalizedProjectId(req.body);
    if (pidFromBody) {
      projectNameCache.delete(pidFromBody);
    } else {
      // If not present, try to find existing record to infer its project id
      const existing = await AppDeployment.findById(req.params.id, {
        projectId: 1,
        project_id: 1,
        'metadata.projectId': 1,
        'project.id': 1,
      }).lean();
      const inferred = extractNormalizedProjectId(existing || {});
      if (inferred) projectNameCache.delete(inferred);
    }

    // Delegate to existing controller (response shape unchanged)
    return controller.update(req, res);
  })
);

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
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    // Before delete, try to load the record to determine project id for invalidation
    const existing = await AppDeployment.findById(req.params.id, {
      projectId: 1,
      project_id: 1,
      'metadata.projectId': 1,
      'project.id': 1,
    }).lean();
    const inferred = extractNormalizedProjectId(existing || {});
    if (inferred) {
      projectNameCache.delete(inferred);
    }

    // Delegate to existing controller (response shape unchanged)
    return controller.remove(req, res);
  })
);

module.exports = router;
