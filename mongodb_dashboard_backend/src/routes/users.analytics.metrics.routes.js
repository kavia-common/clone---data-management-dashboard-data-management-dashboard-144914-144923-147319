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

/**
 * @swagger
 * /api/users/analytics/daily-active:
 *   get:
 *     summary: Daily Active Users (DAU)
 *     description: Returns counts of active users per day using users.updated_at within the provided date range. Defaults to last 30 days when not provided.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, minimum: 1, maximum: 365, default: 30 }
 *         description: Lookback window in days when start_date/end_date are not provided.
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO start datetime (inclusive). When provided, overrides days default.
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO end datetime (inclusive). Default now.
 *       - in: query
 *         name: department
 *         schema: { type: string }
 *         description: Optional department filter.
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *         description: Optional organization filter.
 */
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
 *         description: Active window in days (used if start_date/end_date are not provided)
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO start datetime (inclusive)
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO end datetime (inclusive)
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

/**
 * @swagger
 * /api/users/analytics/active-vs-inactive:
 *   get:
 *     summary: Active vs Inactive users
 *     description: Computes active vs inactive counts using users.updated_at within the provided window or status=='active'. When no dates are provided, uses last 14 days.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: windowDays
 *         schema: { type: integer, minimum: 1, maximum: 365, default: 14 }
 *         description: Active window in days (used if start_date/end_date are not provided)
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO start datetime (inclusive)
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO end datetime (inclusive)
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
 *         description: Active vs inactive counts
 */
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
 *         description: Activity window in days (used if start_date/end_date are not provided)
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO start datetime (inclusive)
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO end datetime (inclusive)
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

/**
 * @swagger
 * /api/users/analytics/summary:
 *   get:
 *     summary: Users analytics summary
 *     description: Returns KPIs: totalActive (last 14 days), newUsersThisWeek (last 7 days), inactive30Days, compliancePct, WAU, MAU. Date math is computed relative to end_date or now, and department/organization_id filters are respected for all metrics.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO start datetime (inclusive) used to cap windows.
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO end datetime (inclusive). Defaults to now.
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
 *         description: Users analytics KPIs
 */
router.get('/summary', summary);

module.exports = router;
