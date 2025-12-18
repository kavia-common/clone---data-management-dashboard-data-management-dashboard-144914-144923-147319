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

/**
 * Note on stability and cancellation prevention:
 * - Always send a single response path: return after res.json/res.status(...).json.
 * - Guard against unresolved promises by setting sane defaults and ensuring awaits are bounded to our own async operations only.
 * - Avoid throwing from downstream helpers by catching and defaulting to null/[].
 */
// PUBLIC_INTERFACE
async function getProjectCreateSummary(req, res, next) {
  try {
    const { range = 'daily', start_date, end_date } = req.query;

    // Accept aliases for tenant/organization id (normalized to string or null)
    const tenant =
      req.query.tenant_id ||
      req.query.organization_id ||
      req.query.organizationId ||
      req.headers['x-organization-id'] ||
      null;

    // Optional single id
    const project_id =
      (req.body && (req.body.project_id ?? req.body.projectId)) ||
      req.query.project_id ||
      req.query.projectId ||
      null;

    // Resolve name for the single id (non-fatal, bounded)
    let single_project_name = null;
    if (project_id) {
      try {
        single_project_name = await resolveProjectName(project_id);
      } catch (e) {
        // swallow and keep null
        single_project_name = null;
      }
    }

    // Early payload; always return 200 with empty buckets even if tenant missing
    let buckets = [];

    if (tenant) {
      // Determine date window
      let windowFrom;
      let windowTo;

      if (range === 'custom') {
        const parsed = parseCustomDateWindow(start_date, end_date);
        if (parsed.error) {
          // For client stability, terminate here with a clear message
          res.set('Cache-Control', 'no-store');
          return res.status(400).json({ success: false, error: parsed.error });
        }
        windowFrom = parsed.from;
        windowTo = parsed.to;
      } else {
        const derived = deriveWindowFromRange(range);
        windowFrom = derived.from;
        windowTo = derived.to;
      }

      // Aggregate by project from SessionTracking; ensure project_id exists to avoid null grouping noise
      const pipeline = [
        {
          $match: {
            tenant_id: tenant,
            $and: [
              {
                $or: [
                  { created_at: { $gte: windowFrom, $lte: windowTo } },
                  { timestamp: { $gte: windowFrom, $lte: windowTo } },
                  { last_updated: { $gte: windowFrom, $lte: windowTo } },
                  { session_start: { $gte: windowFrom, $lte: windowTo } },
                ],
              },
              { project_id: { $exists: true, $ne: null, $ne: '' } },
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

      let results = [];
      try {
        results = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
      } catch (e) {
        // On aggregation error, return a safe empty dataset with diagnostics
        res.set('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true,
          buckets: [],
          diagnostics: { note: 'aggregation_failed', message: e?.message || String(e) },
          ...(project_id ? { project_id, project_name: single_project_name } : {}),
        });
      }

      // Resolve names in bulk for all distinct project_ids (guard map access)
      const ids = Array.isArray(results) ? results.map(r => r?.project_id).filter(Boolean) : [];
      let nameMap = new Map();
      try {
        nameMap = await resolveProjectNames(ids);
      } catch {
        nameMap = new Map();
      }

      buckets = results.map((r) => {
        const pid = r?.project_id ?? '';
        const pname = nameMap.get(String(pid)) ?? null;
        return {
          key: pid,
          project_id: pid,
          project_name: pname,
          label: pname || pid,
          count: r?.count ?? 0,
        };
      });
    }

    const payload = { success: true, buckets };
    if (project_id) {
      payload.project_id = project_id;
      payload.project_name = single_project_name;
    }

    res.set('Cache-Control', 'no-store');
    return res.status(200).json(payload);
  } catch (err) {
    // Ensure single termination path
    try {
      return res.status(500).json({ success: false, error: 'Internal server error' });
    } catch {
      // delegate to error middleware if res.headersSent issue occurs
      if (typeof next === 'function') return next(err);
    }
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getProjectCreateSummary,
};
