'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');

// Models
const User = require('../models/user.model');
const Tenant = require('../models/tenant.model');
const Project = require('../models/project.model');
const SessionTracking = require('../models/sessionTracking.model');
const AppDeployment = require('../models/appDeployments.model');

// Services
const { getSessionDurations, getCosts } = require('../services/analytics');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Dashboard overview endpoints
 */

/**
 * PUBLIC_INTERFACE
 * GET /api/dashboard/overview
 * Returns high-level overview metrics for the dashboard.
 *
 * Response 200 JSON:
 * {
 *   "metrics": {
 *     "counts": {
 *       "users": number,
 *       "tenants": number,
 *       "projects": number,
 *       "sessions": number,
 *       "appDeployments": number
 *     },
 *     "usage": {
 *       "totalMinutes": number,
 *       "totalCostUSD": number
 *     }
 *   },
 *   "recent": {
 *     "sessions": [<session doc subset>],
 *     "deployments": [<deployment doc subset>],
 *     "projects": [<project doc subset>]
 *   },
 *   "items": [
 *     { "title": "Users", "description": "Total users", "value": number },
 *     { "title": "Tenants", "description": "Total organizations", "value": number },
 *     { "title": "Projects", "description": "Total projects", "value": number },
 *     { "title": "Sessions", "description": "Total sessions", "value": number },
 *     { "title": "App Deployments", "description": "Total deployments", "value": number }
 *   ],
 *   "success": true
 * }
 *
 * Notes:
 * - Always returns 200 with structured data. If empty DB, values are zero and arrays empty.
 * - Designed for consumption by the frontend modulesClient (supports data.items or items array).
 */
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    // Compute counts in parallel
    const [
      usersCount,
      tenantsCount,
      projectsCount,
      sessionsCount,
      deploymentsCount,
    ] = await Promise.all([
      User.countDocuments({}).catch(() => 0),
      Tenant.countDocuments({}).catch(() => 0),
      Project.countDocuments({}).catch(() => 0),
      SessionTracking.countDocuments({}).catch(() => 0),
      AppDeployment.countDocuments({}).catch(() => 0),
    ]);

    // Recent docs (safe lean projections)
    const recentSessions = await SessionTracking.find({}, { _id: 1, tenant_id: 1, user_id: 1, project_id: 1, status: 1, total_cost: 1, last_updated: 1, session_start: 1 })
      .sort({ last_updated: -1, session_start: -1 })
      .limit(5)
      .lean()
      .catch(() => []);
    const recentDeployments = await AppDeployment.find({}, { _id: 1, tenant_id: 1, project_id: 1, project_name: 1, status: 1, updated_at: 1, created_at: 1 })
      .sort({ updated_at: -1, created_at: -1 })
      .limit(5)
      .lean()
      .catch(() => []);
    const recentProjects = await Project.find({}, { _id: 1, project_id: 1, project_name: 1, updated_at: 1, created_at: 1 })
      .sort({ updated_at: -1, created_at: -1 })
      .limit(5)
      .lean()
      .catch(() => []);

    // High level usage (across all tenants)
    const [duration, costs] = await Promise.all([
      getSessionDurations({}).catch(() => ({ total_minutes: 0 })),
      getCosts({}).catch(() => ({ total_cost: 0 })),
    ]);

    const metrics = {
      counts: {
        users: Number(usersCount || 0),
        tenants: Number(tenantsCount || 0),
        projects: Number(projectsCount || 0),
        sessions: Number(sessionsCount || 0),
        appDeployments: Number(deploymentsCount || 0),
      },
      usage: {
        totalMinutes: Number(duration?.total_minutes || 0),
        totalCostUSD: Number(costs?.total_cost || 0),
      },
    };

    // Provide an items array for frontend "modules" style cards
    const items = [
      { title: 'Users', description: 'Total users', value: metrics.counts.users },
      { title: 'Tenants', description: 'Total organizations', value: metrics.counts.tenants },
      { title: 'Projects', description: 'Total projects', value: metrics.counts.projects },
      { title: 'Sessions', description: 'Total sessions', value: metrics.counts.sessions },
      { title: 'App Deployments', description: 'Total deployments', value: metrics.counts.appDeployments },
    ];

    // Response structure supports both envelope and direct items parsing
    return res.status(200).json({
      success: true,
      metrics,
      recent: {
        sessions: recentSessions,
        deployments: recentDeployments,
        projects: recentProjects,
      },
      items,
      data: items, // also expose as data for modulesClient compatibility
    });
  })
);

module.exports = router;
