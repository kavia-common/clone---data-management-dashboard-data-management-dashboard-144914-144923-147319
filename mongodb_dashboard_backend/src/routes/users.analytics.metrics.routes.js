'use strict';

const express = require('express');
const router = express.Router();

const {
  dailyActive,
  byDepartment,
  activeVsInactive,
  topActive,
  summary,
  ensureUsersAnalyticsIndexes,
  getDistinctDepartments,
  getDistinctOrganizations,
} = require('../controllers/users.analytics.metrics.controller');

// Initialize indexes once on first import (best-effort)
ensureUsersAnalyticsIndexes().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Failed to ensure users analytics indexes', e);
});

/**
 * Route registrations
 *
 * Note: Route handlers return JSON with ISO dates and counts as per requirements.
 */

// PUBLIC_INTERFACE
// GET /api/users/analytics/daily-active?days=30
router.get('/daily-active', dailyActive);

/**
 * @swagger
 * /api/users/analytics/by-department:
 *   get:
 *     summary: Active users by department
 *     description: Groups users by department where users.updated_at is within the recent window. Optionally filter by department or organization_id.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: windowDays
 *         schema: { type: integer, minimum: 1, maximum: 365, default: 14 }
 *         description: Active window in days
 *       - in: query
 *         name: department
 *         schema: { type: string }
 *         description: Optional department filter
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *         description: Optional organization filter
 *     responses:
 *       200:
 *         description: List of department activity counts
 */
router.get('/by-department', byDepartment);

// PUBLIC_INTERFACE
// GET /api/users/analytics/active-vs-inactive?windowDays=14
router.get('/active-vs-inactive', activeVsInactive);

/**
 * @swagger
 * /api/users/analytics/top-active:
 *   get:
 *     summary: Top active users
 *     description: Returns the most recently active users in the window ordered by updated_at desc. Optionally filter by department and organization_id.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 10 }
 *         description: Number of users to return
 *       - in: query
 *         name: windowDays
 *         schema: { type: integer, minimum: 1, maximum: 365, default: 30 }
 *         description: Activity window in days
 *       - in: query
 *         name: department
 *         schema: { type: string }
 *         description: Optional department filter
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *         description: Optional organization filter
 *     responses:
 *       200:
 *         description: Top users by recency
 */
router.get('/top-active', topActive);

/**
 * Lightweight filter option endpoints
 */
/**
 * @swagger
 * /api/users/analytics/filters/departments:
 *   get:
 *     summary: List distinct departments
 *     description: Returns distinct non-empty department values from users collection.
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: Array of department names
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: string }
 */
router.get('/filters/departments', getDistinctDepartments);

/**
 * @swagger
 * /api/users/analytics/filters/organizations:
 *   get:
 *     summary: List distinct organizations
 *     description: Returns distinct non-empty organization_id values from users collection.
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: Array of organization ids
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: string }
 */
router.get('/filters/organizations', getDistinctOrganizations);

// PUBLIC_INTERFACE
// GET /api/users/analytics/summary
router.get('/summary', summary);

module.exports = router;
