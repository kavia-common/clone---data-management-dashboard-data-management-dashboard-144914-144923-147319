'use strict';

const SessionTracking = require('../models/sessionTracking.model');
const { resolveProjectName, resolveProjectNames } = require('../services/projects.service');

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
   * Fix:
   * - Resolve project_name(s) via centralized projects.service from AppDeployments and other sources.
   * - Use project_name in place of project_id for display labels whenever available.
   * - Gracefully handle missing records and keep original IDs when no name is found.
   *
   * Request:
   * - tenant via query/header (x-organization-id, tenant_id, organization_id)
   * - range=daily|weekly|monthly|custom (+ start_date,end_date for custom)
   * - optional project_id via body or query: include project_name at top-level for convenience.
   *
   * Response:
   *   {
   *     buckets: [ { key: <project_id>, label: <project_name||project_id>, project_id, project_name, count } ],
   *     (optional) project_id,
   *     (optional) project_name
   *   }
   */
  try {
    const { range = 'daily', start_date, end_date } = req.query;

    // Accept aliases for tenant/organization id
    const tenant =
      req.query.tenant_id ||
      req.query.organization_id ||
      req.query.organizationId ||
      req.headers['x-organization-id'];

    // Optional single id
    const project_id = (req.body && req.body.project_id) || req.query.project_id || null;

    // Resolve name for the single id (non-fatal)
    let single_project_name = null;
    if (project_id) {
      try {
        single_project_name = await resolveProjectName(project_id);
      } catch {
        single_project_name = null;
      }
    }

    let buckets = [];
    if (tenant) {
      // Determine date window
      let windowFrom;
      let windowTo;

      if (range === 'custom') {
        const parsed = parseCustomDateWindow(start_date, end_date);
        if (parsed.error) {
          return res.status(400).json({ error: parsed.error });
        }
        windowFrom = parsed.from;
        windowTo = parsed.to;
      } else {
        const derived = deriveWindowFromRange(range);
        windowFrom = derived.from;
        windowTo = derived.to;
      }

      // Aggregate by project from SessionTracking
      const pipeline = [
        {
          $match: {
            tenant_id: tenant,
            // Use last_updated or session_start if present; keep created_at fallback if indexed differently in data.
            $or: [
              { created_at: { $gte: windowFrom, $lte: windowTo } },
              { timestamp: { $gte: windowFrom, $lte: windowTo } },
              { last_updated: { $gte: windowFrom, $lte: windowTo } },
              { session_start: { $gte: windowFrom, $lte: windowTo } },
            ],
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

      // Resolve names in bulk for all distinct project_ids
      const ids = results.map(r => r.project_id).filter(Boolean);
      const nameMap = await resolveProjectNames(ids);

      buckets = results.map((r) => {
        const pid = r.project_id || '';
        const pname = nameMap.get(String(pid)) || null;
        return {
          key: pid,
          project_id: pid,
          project_name: pname,
          label: pname || pid, // Use project_name when available
          count: r.count,
        };
      });
    } else {
      // No tenant: keep buckets empty but still include top-level project name if requested
      buckets = [];
    }

    const payload = { buckets };
    if (project_id) {
      payload.project_id = project_id;
      payload.project_name = single_project_name;
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
