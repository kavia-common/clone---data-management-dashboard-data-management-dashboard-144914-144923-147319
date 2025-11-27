'use strict';

/**
 * PUBLIC_INTERFACE
 * getProjectsSummaryByUser
 * Controller: GET /api/projects/summary-by-user
 * Aggregates session_tracking by user_id and project_id for a given tenant and optional [from,to] date range.
 * Returns compact summaries per user with distinct projects count and last activity.
 *
 * Query params:
 * - organization_id | tenant_id: required tenant id (unless middleware sets req.tenantId)
 * - from, to: optional ISO date strings; inclusive range; applied across last_updated|timestamp|session_start (any present)
 *
 * Response (200):
 *   [
 *     {
 *       user_id: "u1",
 *       projects_count: 3,
 *       last_activity: "2025-10-01T12:34:56.000Z"
 *     },
 *     ...
 *   ]
 * On no data: returns [].
 */
async function getProjectsSummaryByUser(req, res) {
  try {
    const tenantId =
      (req.query.organization_id || req.query.tenant_id || req.organizationId || req.tenantId || '')
        .toString()
        .trim();

    // When verifyAuth/requireTenant are mounted, req.tenantId should exist; but stay lenient and allow explicit query/header in demo.
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'organization_id/tenant_id is required' });
    }

    // Validate dates
    const { from, to } = req.query || {};
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (from && Number.isNaN(fromDate?.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "from" date' });
    }
    if (to && Number.isNaN(toDate?.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "to" date' });
    }

    const { aggregateProjectSummariesByUser } = require('../services/projects.summary.service');
    const items = await aggregateProjectSummariesByUser({ tenantId, fromDate, toDate });

    return res.status(200).json(Array.isArray(items) ? items : []);
  } catch (err) {
    // Stable empty response on error
    try { console.error('[projects.summary.controller] /summary-by-user error:', err?.message || err); } catch {}
    return res.status(200).json([]);
  }
}

/**
 * PUBLIC_INTERFACE
 * getProjectsSummaryByDepartment
 * Controller: GET /api/projects/summary-by-department
 * Aggregates session_tracking by department (from users collection) and project_id for a given tenant and optional [from,to] date range.
 *
 * Query params:
 * - organization_id | tenant_id: required tenant id (unless middleware sets req.tenantId)
 * - from, to: optional ISO strings
 *
 * Response (200):
 *   [
 *     {
 *       department: "Engineering",
 *       projects_count: 7,
 *       users_count: 12,
 *       last_activity: "2025-10-01T12:34:56.000Z"
 *     },
 *     ...
 *   ]
 * On no data: returns [].
 */
async function getProjectsSummaryByDepartment(req, res) {
  try {
    const tenantId =
      (req.query.organization_id || req.query.tenant_id || req.organizationId || req.tenantId || '')
        .toString()
        .trim();

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'organization_id/tenant_id is required' });
    }

    const { from, to } = req.query || {};
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (from && Number.isNaN(fromDate?.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "from" date' });
    }
    if (to && Number.isNaN(toDate?.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "to" date' });
    }

    const { aggregateProjectSummariesByDepartment } = require('../services/projects.summary.service');
    const items = await aggregateProjectSummariesByDepartment({ tenantId, fromDate, toDate });

    return res.status(200).json(Array.isArray(items) ? items : []);
  } catch (err) {
    try { console.error('[projects.summary.controller] /summary-by-department error:', err?.message || err); } catch {}
    return res.status(200).json([]);
  }
}

module.exports = {
  getProjectsSummaryByUser,
  getProjectsSummaryByDepartment,
};
