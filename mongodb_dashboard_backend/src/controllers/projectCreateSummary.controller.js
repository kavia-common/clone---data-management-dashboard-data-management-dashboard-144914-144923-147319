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
   * Mandatory filters:
   *  - Tenant/organization id: accept organization_id, organizationId, or tenant_id (alias to tenant_id). Also honor x-organization-id header.
   *  - Date range on created_at: derived from ?range=daily|weekly|monthly for today (UTC) or
   *    when range=custom, from start_date/end_date (YYYY-MM-DD) converted to UTC start/end of day.
   *
   * Response shape must be exactly:
   *   { buckets: [{ key: project_id, label: project_id, count }] }
   *
   * 400 when tenant missing or date range invalid (for custom when one of from/to is missing).
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

    if (!tenant) {
      return res.status(400).json({ error: 'Missing tenant/organization id' });
    }

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

    // Build aggregation pipeline as specified:
    // 1) $match using created_at between from/to and tenant filter.
    // 2) $group by "$project_id" with fields: _id, project_id:$first, count:$sum
    // 3) $sort by { count: -1 }
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

    // Keep payload exactly as requested
    const buckets = results.map((r) => ({
      key: r.project_id,
      label: r.project_id,
      count: r.count,
    }));

    return res.json({ buckets });
  } catch (err) {
    if (typeof next === 'function') return next(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getProjectCreateSummary,
};
