'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');

// Reuse models and services from the main overview route
const User = require('../models/user.model');
const Tenant = require('../models/tenant.model');
const Project = require('../models/project.model');
const SessionTracking = require('../models/sessionTracking.model');
const AppDeployment = require('../models/appDeployments.model');
const { getSessionDurations, getCosts } = require('../services/analytics');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/dashboard/overview/modules
 * Returns a simplified modules-friendly overview payload with items (cards) and minimal metrics.
 * Frontend can render cards directly from items without additional mapping.
 *
 * Response 200 JSON:
 * {
 *   success: true,
 *   items: [
 *     { key: "users",        title: "Users",            description: "Total users",          value: number },
 *     { key: "tenants",      title: "Tenants",          description: "Total organizations",  value: number },
 *     { key: "projects",     title: "Projects",         description: "Total projects",       value: number },
 *     { key: "sessions",     title: "Sessions",         description: "Total sessions",       value: number },
 *     { key: "deployments",  title: "App Deployments",  description: "Total deployments",    value: number },
 *     { key: "minutes",      title: "Total Minutes",    description: "Aggregated session minutes", value: number },
 *     { key: "cost_usd",     title: "Total Cost (USD)", description: "Aggregated LLM costs", value: number }
 *   ],
 *   metrics: { counts: {...}, usage: {...} }
 * }
 */
router.get(
  '/modules',
  asyncHandler(async (_req, res) => {
    const [usersCount, tenantsCount, projectsCount, sessionsCount, deploymentsCount] = await Promise.all([
      User.countDocuments({}).catch(() => 0),
      Tenant.countDocuments({}).catch(() => 0),
      Project.countDocuments({}).catch(() => 0),
      SessionTracking.countDocuments({}).catch(() => 0),
      AppDeployment.countDocuments({}).catch(() => 0),
    ]);

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

    const items = [
      { key: 'users',       title: 'Users',            description: 'Total users',                 value: metrics.counts.users },
      { key: 'tenants',     title: 'Tenants',          description: 'Total organizations',         value: metrics.counts.tenants },
      { key: 'projects',    title: 'Projects',         description: 'Total projects',              value: metrics.counts.projects },
      { key: 'sessions',    title: 'Sessions',         description: 'Total sessions',              value: metrics.counts.sessions },
      { key: 'deployments', title: 'App Deployments',  description: 'Total deployments',           value: metrics.counts.appDeployments },
      { key: 'minutes',     title: 'Total Minutes',    description: 'Aggregated session minutes',  value: metrics.usage.totalMinutes },
      { key: 'cost_usd',    title: 'Total Cost (USD)', description: 'Aggregated LLM costs',        value: metrics.usage.totalCostUSD },
    ];

    return res.status(200).json({ success: true, items, metrics });
  })
);

module.exports = router;
