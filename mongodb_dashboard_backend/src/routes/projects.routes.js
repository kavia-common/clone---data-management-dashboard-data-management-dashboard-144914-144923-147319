const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const Project = require('../models/project.model');
const Tenant = require('../models/tenant.model');
const { getSessionDurations, getCosts } = require('../services/analytics');

const router = express.Router();
const controller = buildCrudController(Project, '-created_at');

/**
 * @swagger
 * tags:
 *   name: Projects
 *   description: Project endpoints with ownership/access and usage aggregations
 */

// Basic CRUD
router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

/**
 * @swagger
 * /api/projects/{projectId}/overview:
 *   get:
 *     summary: Project overview
 *     description: Provides project info with ownership, access, allocated/used/balance credits, and usage aggregations.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Project overview payload
 *       404:
 *         description: Project not found
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/overview
 * Provides project info with user time consumption, ownership, access, and cost usage.
 */
router.get(
  '/:projectId/overview',
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const project = await Project.findOne({ project_id: projectId }).lean();
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Fetch tenant for naming/context if needed
    const tenant = await Tenant.findOne({ tenant_id: project.tenant_id }).lean();

    const [costs, durations] = await Promise.all([
      getCosts({ tenant_id: project.tenant_id, project_id: projectId }),
      getSessionDurations({ tenant_id: project.tenant_id, project_id: projectId }),
    ]);

    // Compose user usage list
    const userSet = new Set([
      ...Object.keys(costs.cost_by_user || {}),
      ...Object.keys(durations.minutes_by_user || {}),
    ]);

    const users = Array.from(userSet).map((uid) => ({
      user_id: uid,
      total_cost: Number(costs.cost_by_user[uid] || 0),
      total_minutes: Number(durations.minutes_by_user[uid] || 0),
      // Access info if present on project
      access: (project.access_users || []).find((au) => String(au.user_id) === String(uid)) || null,
    }));

    const allocated = Number(project.allocated_credits || 0);
    const used = Number(costs.total_cost || 0);
    const balance = allocated - used;

    return res.status(200).json({
      project: {
        project_id: project.project_id,
        project_name: project.project_name,
        tenant_id: project.tenant_id,
        tenant_name: tenant?.tenant_name || null,
        owner_user_id: project.owner_user_id,
        status: project.status,
        allocated_credits: allocated,
        credits_unit: project.credits_unit || 'USD',
        used_credits: used,
        balance_credits: balance,
        tags: project.tags || [],
        access_users: project.access_users || [],
      },
      usage: {
        total_minutes: durations.total_minutes,
        sessions_count: durations.sessions_count,
        cost_total: costs.total_cost,
      },
      users,
    });
  })
);

/**
 * @swagger
 * /api/projects/{projectId}/users/usage:
 *   get:
 *     summary: Project users usage
 *     description: Returns per-user total cost and total minutes for a given project.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Users usage for the project
 *       404:
 *         description: Project not found
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/users/usage
 * User drill-down for a project: costs and time spent per user.
 */
router.get(
  '/:projectId/users/usage',
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;
    const project = await Project.findOne({ project_id: projectId }).lean();
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const [costs, durations] = await Promise.all([
      getCosts({ tenant_id: project.tenant_id, project_id: projectId }),
      getSessionDurations({ tenant_id: project.tenant_id, project_id: projectId }),
    ]);

    const user_ids = new Set([
      ...Object.keys(costs.cost_by_user || {}),
      ...Object.keys(durations.minutes_by_user || {}),
    ]);

    const users = Array.from(user_ids).map((uid) => ({
      user_id: uid,
      total_cost: Number(costs.cost_by_user[uid] || 0),
      total_minutes: Number(durations.minutes_by_user[uid] || 0),
    }));

    return res.status(200).json({
      project_id: projectId,
      tenant_id: project.tenant_id,
      users,
    });
  })
);

module.exports = router;
