'use strict';

const SessionTracking = require('../models/sessionTracking.model');
const AppDeployment = require('../models/appDeployments.model');

/**
 * Helper: parse YYYY-MM-DD into UTC start-of-day and end-of-day Date objects.
 */
function parseCustomDateWindow(startStr, endStr) {
  if (!startStr || !endStr) {
    return { error: 'Invalid date range: start_date and end_date are required for custom range' };
  }
  // Basic YYYY-MM-DD validation
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(startStr) || !re.test(endStr)) {
    return { error: 'Invalid date format: use YYYY-MM-DD for start_date and end_date' };
  }
  const from = new Date(`${startStr}T00:00:00.000Z`);
  const to = new Date(`${endStr}T23:59:59.999Z`);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return { error: 'Invalid date range: could not parse dates' };
  }
  return { from, to };
}

/**
 * Helper: derive date window for today in UTC given a range of daily|weekly|monthly.
 * Returns { from: Date, to: Date }
 */
function deriveWindowFromRange(range) {
  const now = new Date();
  // today at 00:00:00.000Z
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

  if (range === 'daily') {
    return {
      from: startOfToday,
      to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)),
    };
  }

  if (range === 'weekly') {
    // Monday as first day of week
    const day = startOfToday.getUTCDay(); // 0=Sun .. 6=Sat
    const diff = (day + 6) % 7; // days since Monday
    const from = new Date(startOfToday);
    from.setUTCDate(from.getUTCDate() - diff);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 6);
    to.setUTCHours(23, 59, 59, 999);
    return { from, to };
  }

  if (range === 'monthly') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    // last day of current month at 23:59:59.999Z
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    return { from, to };
  }

  // Default to daily
  return {
    from: startOfToday,
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)),
  };
}

// PUBLIC_INTERFACE
async function getProjectCreateSummary(req, res, next) {
  /**
   * Returns projects created summary grouped by project_id from SessionTracking.
   *
   * Enhancements per request:
   * - When a specific "project_id" is provided via body or query, include "project_name"
   *   resolved from AppDeployment by matching AppDeployment.project_id (and common aliases).
   *   If no matching record is found, project_name is null. This is additive and does not
   *   break existing consumers.
   *
   * Additional behavior retained:
   * - Accept organization/tenant id via query/header for the aggregation portion.
   * - Support range=daily|weekly|monthly|custom with start_date/end_date.
   *
   * Response:
   * - If "project_id" is provided: include { project_id, project_name } in the payload,
   *   along with the existing buckets array when tenant/range filters are provided.
   * - If "project_id" is not provided: only the original buckets behavior is returned.
   */
  try {
    const {
      range = 'daily',
      start_date,
      end_date,
    } = req.query;

    // Accept aliases for tenant/organization id
    const tenant =
      req.query.tenant_id ||
      req.query.organization_id ||
      req.query.organizationId ||
      req.headers['x-organization-id'];

    // Optional project_id for name resolution (additive behavior)
    const project_id = (req.body && req.body.project_id) || req.query.project_id || null;

    // Build optional project_name resolution (non-fatal if it fails or not found)
    let project_name = null;
    if (project_id) {
      try {
        const deployment = await AppDeployment
          .findOne(
            {
              $or: [
                { project_id: project_id },
                { projectId: project_id },
                { 'metadata.projectId': project_id },
                { 'project.id': project_id },
              ],
            },
            { project_name: 1, projectName: 1, 'project.name': 1, name: 1 }
          )
          .lean()
          .exec();

        if (deployment) {
          project_name =
            deployment.project_name ??
            deployment.projectName ??
            (deployment.project && deployment.project.name) ??
            deployment.name ??
            null;
        }
      } catch (lookupErr) {
        // swallow lookup errors and keep project_name as null
        project_name = null;
      }
    }

    // If tenant context is not provided, we still return success for the project_name part (if requested)
    // but for buckets we require tenant as before to avoid breaking expectations.
    let buckets = [];
    if (tenant) {
      // Determine date window
      let windowFrom;
      let windowTo;

      if (range === 'custom') {
        const parsed = parseCustomDateWindow(start_date, end_date);
        if (parsed.error) {
          // If custom date range invalid, preserve existing behavior by returning 400.
          return res.status(400).json({ error: parsed.error });
        }
        windowFrom = parsed.from;
        windowTo = parsed.to;
      } else {
        const derived = deriveWindowFromRange(range);
        windowFrom = derived.from;
        windowTo = derived.to;
      }

      // Aggregate by project from SessionTracking (existing behavior)
      const pipeline = [
        {
          $match: {
            tenant_id: tenant,
            created_at: { $gte: windowFrom, $lte: windowTo },
          },
        },
        {
          $group: {
            _id: '$project_id',
            project_id: { $first: '$project_id' },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ];

      const results = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
      buckets = results.map((r) => ({
        key: r.project_id,
        label: r.project_id,
        count: r.count,
      }));
    } else {
      // No tenant provided; maintain backward compatibility:
      // - We won't compute buckets (requires tenant).
      // - Return empty buckets array and still include project_name if project_id is provided.
      buckets = [];
    }

    // Compose response. Keep existing fields intact, only add project_name if project_id was requested.
    const payload = { buckets };
    if (project_id) {
      payload.project_id = project_id;
      payload.project_name = project_name;
    }

    return res.json(payload);
  } catch (err) {
    if (typeof next === 'function') return next(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getProjectCreateSummary,
};
