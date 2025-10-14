'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { newUsersOverTime } = require('../controllers/analytics.controller');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Analytics
 *   description: Analytics endpoints
 */

/**
 * @swagger
 * /api/analytics/users/new-over-time:
 *   get:
 *     summary: New users over time
 *     description: >
 *       Aggregates users by created_at into time buckets based on granularity (day|week|month) and returns counts.
 *       Fills missing intervals with zero on the server.
 *     tags:
 *       - Analytics
 *     parameters:
 *       - in: query
 *         name: granularity
 *         schema:
 *           type: string
 *           enum:
 *             - day
 *             - week
 *             - month
 *           default: day
 *         description: Bucket granularity
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO start datetime (inclusive). Default depends on granularity: last 90 days (day), 26 weeks (week), 12 months (month).
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO end datetime (inclusive). Default now.
 *     responses:
 *       200:
 *         description: Aggregated new users over time
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 granularity:
 *                   type: string
 *                 start:
 *                   type: string
 *                   format: date-time
 *                 end:
 *                   type: string
 *                   format: date-time
 *                 points:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       bucket:
 *                         type: string
 *                         description: 'YYYY-MM-DD for day, YYYY-WWW for week, or YYYY-MM for month'
 *                       count:
 *                         type: integer
 */
router.get('/users/new-over-time', asyncHandler(newUsersOverTime));

module.exports = router;
