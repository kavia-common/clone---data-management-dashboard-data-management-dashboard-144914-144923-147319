const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const Project = require('../models/project.model');
const Tenant = require('../models/tenant.model');
const SessionTracking = require('../models/sessionTracking.model');
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
 * /api/projects/{projectId}/usage:
 *   get:
 *     summary: Project usage (credits and cost)
 *     description: Returns credits used and total cost for a given project, aggregated from LLM costs. Falls back to zero if not found.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Usage totals for the project
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projectId:
 *                   type: string
 *                 creditsUsed:
 *                   type: number
 *                 cost:
 *                   type: number
 *                 currency:
 *                   type: string
 *       404:
 *         description: Project not found
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/usage
 * Returns project-level credits used and cost totals.
 */
router.get(
  '/:projectId/usage',
  asyncHandler(async (req, res) => {
    const { projectId } = req.params;

    // Ensure the project exists to return 404 for invalid ids
    const project = await Project.findOne({ project_id: projectId }).lean();
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Aggregate from LLMCosts via analytics service for consistency
    const costs = await (async () => {
      try {
        const result = await getCosts({ tenant_id: project.tenant_id, project_id: projectId });
        return result || { total_cost: 0 };
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Error aggregating project usage:', e);
        return { total_cost: 0 };
      }
    })();

    const creditsUsed = Number(costs.total_cost || 0);
    const cost = creditsUsed;
    const currency = project.credits_unit || 'USD';

    return res.status(200).json({
      projectId,
      creditsUsed,
      cost,
      currency,
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

/**
 * @swagger
 * /api/projects/{projectId}/cost:
 *   get:
 *     summary: Project total cost (from session tracking)
 *     description: >
 *       Aggregates cost for a project by summing total_cost across session tracking documents that match the given projectId.
 *       Returns 0 if no sessions are found. Currency is taken from the project document if available (credits_unit, default USD).
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Cost total for the project
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projectId: { type: string, description: "Project identifier" }
 *                 cost: { type: number, description: "Sum of total_cost across sessions" }
 *                 currency: { type: string, description: "Currency code, defaults to USD" }
 *       404:
 *         description: Project not found
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/cost
 * Aggregates total cost for a project from session_tracking collection.
 */
router.get(
  '/:projectId/cost',
  asyncHandler(async (req, res) => {
    // Ensure projectId is treated strictly as a string for matching
    const projectId = String(req.params.projectId);

    // We do not 404 when computing cost-only per new requirement. If project not found, still return cost=0.
    // However, we will attempt to read currency from project if available.
    let currency = 'USD';
    try {
      const project = await Project.findOne({ project_id: projectId }).lean();
      if (project && project.credits_unit) {
        currency = project.credits_unit;
      }
    } catch (e) {
      // ignore project lookup errors, default currency remains USD
    }

    // Aggregation pipeline:
    // - Match by project_id string
    // - Group by project_id and sum with numeric coercion
    // - Coerce total_cost using $ifNull -> $toDouble to handle Number, String, Decimal128 and null
    const pipeline = [
      { $match: { project_id: projectId } },
      {
        $group: {
          _id: '$project_id',
          cost: {
            $sum: {
              $toDouble: {
                $ifNull: ['$total_cost', 0],
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          projectId: '$_id',
          cost: 1,
        },
      },
    ];

    let projectCost = 0;
    try {
      const result = await SessionTracking.aggregate(pipeline);
      // If no records found, default to 0 as per requirement
      projectCost = Number(result?.[0]?.cost ?? 0);
      if (!Number.isFinite(projectCost)) projectCost = 0;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Error aggregating session tracking cost for projectId=${projectId}`, err?.message || err);
      projectCost = 0;
    }

    // Always return 200 with { projectId, cost } even if not found in sessions
    return res.status(200).json({
      projectId,
      cost: projectCost,
      currency,
    });
  })
);

/**
 * @swagger
 * /api/projects/{projectId}/cost-history-sum:
 *   get:
 *     summary: Project total cost from cost_history deltas (session tracking)
 *     description: >
 *       Aggregates project cost as the sum of all cost_history.delta_total_cost across session_tracking documents where project_id matches the given projectId.
 *       Handles missing or empty cost_history gracefully and coerces delta_total_cost values to numbers.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Project cost aggregated from cost_history deltas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 projectId:
 *                   type: string
 *                 cost:
 *                   type: number
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/cost-history-sum
 * Sums cost_history.delta_total_cost across all session_tracking documents for the given project.
 */
router.get(
  '/:projectId/cost-history-sum',
  asyncHandler(async (req, res) => {
    const projectIdStr = String(req.params.projectId);

    // Aggregation pipeline as specified in requirements
    const pipeline = [
      { $match: { project_id: projectIdStr } },
      {
        $project: {
          deltas: {
            $map: {
              input: { $ifNull: ['$cost_history', []] },
              as: 'ch',
              in: {
                $toDouble: { $ifNull: ['$$ch.delta_total_cost', 0] },
              },
            },
          },
        },
      },
      {
        $project: {
          sumDeltas: { $sum: '$deltas' },
        },
      },
      {
        $group: {
          _id: null,
          projectCost: { $sum: '$sumDeltas' },
        },
      },
    ];

    let projectCost = 0;
    try {
      const result = await SessionTracking.aggregate(pipeline);
      projectCost = Number(result?.[0]?.projectCost ?? 0);
      if (!Number.isFinite(projectCost)) projectCost = 0;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `Error aggregating cost_history deltas for projectId=${projectIdStr}`,
        err?.message || err
      );
      projectCost = 0;
    }

    return res.status(200).json({
      projectId: projectIdStr,
      cost: projectCost,
    });
  })
);

module.exports = router;
