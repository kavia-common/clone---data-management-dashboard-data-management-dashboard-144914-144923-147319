'use strict';

const SessionTracking = require('../models/sessionTracking.model');

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
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

  if (range === 'daily') {
    return {
      from: startOfToday,
      to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)),
    };
  }

  if (range === 'weekly') {
    // Monday as first day of week
    const day = startOfToday.getUTCDay();
    const diff = (day + 6) % 7;
    const from = new Date(startOfToday);
    from.setUTCDate(from.getUTCDate() - diff);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 6);
    to.setUTCHours(23, 59, 59, 999);
    return { from, to };
  }

  if (range === 'monthly') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    return { from, to };
  }

  return {
    from: startOfToday,
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)),
  };
}

/**
 * PUBLIC_INTERFACE
 * getProjectCreateSummary
 * Reverted to last known-good logic: only aggregates SessionTracking by project_id within the
 * requested window and tenant scope. No AppDeployment or user_name lookups are performed.
 * Response mapping is updated so the payload displays user_id instead of project_id.
 * Inputs, behavior and performance remain consistent and deterministic 200 JSON.
 */
async function getProjectCreateSummary(req, res, next) {
  const t0 = Date.now();
  try {
    const { range = 'daily', start_date, end_date } = req.query;

    // Accept aliases for tenant/organization id (normalized to string or null)
    const tenant =
      req.query.tenant_id ||
      req.query.organization_id ||
      req.query.organizationId ||
      req.headers['x-organization-id'] ||
      null;

    // Accept project_id (previous behavior) but do not use it for lookups; preserved for compatibility
    const project_id =
      (req.body && (req.body.project_id ?? req.body.projectId)) ||
      req.query.project_id ||
      req.query.projectId ||
      null;

    let buckets = [];

    if (tenant) {
      // Determine date window
      let windowFrom;
      let windowTo;

      if (range === 'custom') {
        const parsed = parseCustomDateWindow(start_date, end_date);
        if (parsed.error) {
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

      // Last known-good: aggregate by project_id and count sessions within window and tenant
      const pipeline = [
        {
          $match: {
            tenant_id: String(tenant),
            $and: [
              {
                $or: [
                  { created_at: { $gte: windowFrom, $lte: windowTo } },
                  { timestamp: { $gte: windowFrom, $lte: windowTo } },
                  { last_updated: { $gte: windowFrom, $lte: windowTo } },
                  { session_start: { $gte: windowFrom, $lte: windowTo } },
                ],
              },
              { project_id: { $exists: true } },
            ],
          },
        },
        {
          $group: {
            _id: { $ifNull: [{ $toString: '$project_id' }, '' ] },
            project_id: { $first: { $ifNull: [{ $toString: '$project_id' }, '' ] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ];

      let results = [];
      try {
        results = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
      } catch (e) {
        try { console.warn('[project-create] aggregation failed:', e?.message || e); } catch {}
        res.set('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true,
          buckets: [],
          diagnostics: { note: 'aggregation_failed', message: e?.message || String(e) },
          ...(project_id ? { user_id: String(project_id) } : {}),
        });
      }

      // Map to response buckets. IMPORTANT: replace project_id display with user_id per request.
      buckets = (results || []).map((r) => {
        const pid = r?.project_id != null ? String(r.project_id) : '';
        return {
          key: pid,
          user_id: pid, // replace project_id with user_id in the payload
          label: pid,
          count: r?.count ?? 0,
        };
      });
    }

    // Build payload; deterministically returns 200 JSON
    const payload = { success: true, buckets };
    if (project_id) {
      // Replace top-level project_id with user_id as requested
      payload.user_id = String(project_id);
    }

    res.set('Cache-Control', 'no-store');
    res.set('x-project-create-ms', String(Date.now() - t0));
    if (tenant) res.set('x-project-create-tenant', String(tenant));
    if (project_id) res.set('x-project-id', String(project_id));
    return res.status(200).json(payload);
  } catch (err) {
    try { console.warn('[project-create] unhandled error:', err?.message || err); } catch {}
    try {
      return res.status(200).json({ success: true, buckets: [] });
    } catch {
      if (typeof next === 'function') return next(err);
    }
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getProjectCreateSummary,
};
