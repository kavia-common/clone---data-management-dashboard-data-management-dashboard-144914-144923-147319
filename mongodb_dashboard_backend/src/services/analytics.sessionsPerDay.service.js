'use strict';

/**
 * PUBLIC_INTERFACE
 * getSessionsPerDay
 * Aggregates session_tracking by UTC day using session_start and returns [{ date: 'YYYY-MM-DD', count: number }].
 * Optional filters via query: tenant_id, project_id, status (pipe-separated statuses supported).
 * Ensures results are sorted ascending by date. Gracefully returns [] when no data is found.
 */

const { getCollection } = require('../config/db');

/**
 * Build a MongoDB $match filter object from optional query filters.
 * Supports:
 *  - tenant_id: string
 *  - project_id: string
 *  - status: string | "completed|active" (pipe-separated list -> $in)
 */
function buildFilter({ tenant_id, project_id, status }) {
  const filter = {};
  if (tenant_id && typeof tenant_id === 'string' && tenant_id.trim() !== '') {
    filter.tenant_id = tenant_id.trim();
  }
  if (project_id && typeof project_id === 'string' && project_id.trim() !== '') {
    filter.project_id = project_id.trim();
  }
  if (status && typeof status === 'string' && status.trim() !== '') {
    // Allow pipe separated values -> $in
    const parts = status.split('|').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1) {
      filter.status = parts[0];
    } else if (parts.length > 1) {
      filter.status = { $in: parts };
    }
  }
  return filter;
}

/**
 * PUBLIC_INTERFACE
 * getSessionsPerDay
 * @param {Object} params
 * @param {string=} params.tenant_id
 * @param {string=} params.project_id
 * @param {string=} params.status
 * @returns {Promise<Array<{ date: string, count: number }>>}
 */
async function getSessionsPerDay({ tenant_id, project_id, status } = {}) {
  // Build base $match
  const match = buildFilter({ tenant_id, project_id, status });

  // Only include documents that have session_start
  match.session_start = { $type: 'date' };

  const collection = await getCollection('session_tracking');

  // Use $dateToString with UTC timezone to get 'YYYY-MM-DD'
  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: {
          $dateToString: {
            date: '$session_start',
            format: '%Y-%m-%d',
            timezone: 'UTC',
          },
        },
        count: { $sum: 1 },
      },
    },
    { $project: { _id: 0, date: '$_id', count: 1 } },
    { $sort: { date: 1 } },
  ];

  const results = await collection.aggregate(pipeline).toArray();
  // Ensure array and types
  return Array.isArray(results)
    ? results.map((r) => ({
        date: String(r.date),
        count: Number(r.count) || 0,
      }))
    : [];
}

module.exports = {
  getSessionsPerDay,
};
