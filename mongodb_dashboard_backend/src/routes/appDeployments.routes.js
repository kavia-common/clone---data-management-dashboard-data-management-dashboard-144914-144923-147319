const express = require('express');
const { asyncHandler, failure } = require('../utils/http');
const AppDeployment = require('../models/appDeployments.model');
const { buildCrudController } = require('../controllers/crudFactory');
const { validateAppDeployment } = require('../middleware/validators');
const { normalizeProjectId } = require('../services/enrichment.util');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');

const router = express.Router();
// Enforce auth + tenant on all app-deployments routes
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

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
 *     description: >
 *       Paginated list with optional filter and sort.
 *       Tenant scope is enforced server-side from JWT/header or query (?tenant_id=... or legacy ?organization_id=...).
 *       Any client-provided tenant_id keys in the filter are ignored and replaced by the resolved tenant.
 *     tags: [AppDeployments]
 *     parameters:
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *         description: Tenant identifier (alias: organization_id). Prefer header x-organization-id; query is accepted.
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *         description: Legacy alias for tenant_id. Mapped to tenant_id server-side.
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
 *         description: >
 *           JSON filter (e.g., {"project_id":"p1","status":"success"}).
 *           Any tenant_id/organization_id sent here is ignored; server enforces tenant from JWT/header/query.
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
router.get('/', verifyAuth, requireTenant, asyncHandler(controller.list));

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
      return res.status(200).json({ projectId: originalId || '', projectName: null });
    }

    const cached = cacheGet(pid);
    if (cached !== null && cached !== undefined) {
      return res.status(200).json({ projectId: pid, projectName: cached });
    }

    // Build OR query across possible id fields in deployments and enforce tenant
    const idQuery = {
      tenant_id: String(req.tenantId),
      $or: [
        { projectId: pid },
        { project_id: pid },
        { 'metadata.projectId': pid },
        { 'project.id': pid },
      ],
    };

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

    const dep = await AppDeployment.findOne(idQuery, projection)
      .sort({ updatedAt: -1, updated_at: -1, createdAt: -1, created_at: -1 })
      .lean();

    const name =
      dep?.projectName ||
      dep?.project_name ||
      dep?.metadata?.projectName ||
      dep?.project?.name ||
      null;

    cacheSet(pid, name);

    return res.status(200).json({ projectId: pid, projectName: name ? String(name) : null });
  })
);

/**
 * @swagger
 * /api/app-deployments/{id}:
 *   get:
 *     summary: Get app deployment by ID
 *     description: >
 *       Returns the document only if it belongs to the resolved tenant (JWT/header/query).
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
router.get('/:id', verifyAuth, requireTenant, asyncHandler(controller.getById));

/**
 * @swagger
 * /api/app-deployments:
 *   post:
 *     summary: Create app deployment
 *     description: >
 *       Allows tenant_id in payload but server will always override it using resolved tenant (JWT/header/query).
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
  verifyAuth,
  requireTenant,
  validateAppDeployment,
  asyncHandler(async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: 'Bad request: payload must be an object' });
    }
    // strip any client-provided tenant_id and let controller stamp it
    if ('tenant_id' in req.body) delete req.body.tenant_id;

    const pid = extractNormalizedProjectId(req.body);
    if (pid) {
      projectNameCache.delete(pid);
    }
    return controller.create(req, res);
  })
);

/**
 * @swagger
 * /api/app-deployments/{id}:
 *   put:
 *     summary: Update app deployment
 *     description: >
 *       Update is tenant-scoped. If payload includes tenant_id, it is ignored and replaced by server-side tenant.
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
  verifyAuth,
  requireTenantMw,
  validateAppDeployment,
  asyncHandler(async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: 'Bad request: payload must be an object' });
    }
    if ('tenant_id' in req.body) delete req.body.tenant_id;

    const pidFromBody = extractNormalizedProjectId(req.body);
    if (pidFromBody) {
      projectNameCache.delete(pidFromBody);
    } else {
      const existing = await AppDeployment.findById(req.params.id, {
        projectId: 1,
        project_id: 1,
        'metadata.projectId': 1,
        'project.id': 1,
      }).lean();
      const inferred = extractNormalizedProjectId(existing || {});
      if (inferred) projectNameCache.delete(inferred);
    }
    return controller.update(req, res);
  })
);

/**
 * @swagger
 * /api/app-deployments/{id}:
 *   delete:
 *     summary: Delete app deployment
 *     description: >
 *       Delete is tenant-scoped; only records under the resolved tenant will be affected.
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
  verifyAuth,
  requireTenantMw,
  asyncHandler(async (req, res) => {
    // Try to fetch tenant-scoped record to invalidate cache appropriately
    const existing = await AppDeployment.findOne(
      { _id: req.params.id, tenant_id: String(req.tenantId) },
      {
        projectId: 1,
        project_id: 1,
        'metadata.projectId': 1,
        'project.id': 1,
      }
    ).lean();
    const inferred = extractNormalizedProjectId(existing || {});
    if (inferred) projectNameCache.delete(inferred);

    return controller.remove(req, res);
  })
);

module.exports = router;
