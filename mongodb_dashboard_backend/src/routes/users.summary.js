const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/users/summary
 * Users created summary grouped by time buckets.
 *
 * Query params:
 * - organization_id (string, required unless provided by auth/header), alias: tenant_id
 * - range: 'daily' | 'weekly' | 'monthly' | 'custom' (default: 'daily')
 * - start_date, end_date (YYYY-MM-DD) required when range='custom'
 *
 * Timezone: All computations use UTC.
 *
 * Returns 200 JSON:
 * {
 *   range: 'daily'|'weekly'|'monthly'|'custom',
 *   start_date: 'YYYY-MM-DD',
 *   end_date: 'YYYY-MM-DD',
 *   bins: [ { label, count, start, end } ]
 * }
 *
 * 400 on invalid parameters.
 */
router.get('/summary', async (req, res) => {
  try {
    const { organization_id, tenant_id } = req.query;
    let { range = 'daily', start_date, end_date } = req.query;

    // Normalize range
    const ALLOWED_RANGES = new Set(['daily', 'weekly', 'monthly', 'custom']);
    range = String(range || 'daily').toLowerCase();
    if (!ALLOWED_RANGES.has(range)) {
      return res.status(400).json({ message: "Invalid 'range'. Use daily|weekly|monthly|custom." });
    }

    // Resolve tenant (organization) id from query, auth context, or header
    let tenant = organization_id || tenant_id;
    const authTenant =
      (req.auth && (req.auth.tenantId || req.auth.organization_id || req.auth.organizationId)) ||
      (req.user && (req.user.tenantId || req.user.organization_id || req.user.organizationId));
    if (!tenant && authTenant) tenant = authTenant;
    if (!tenant && req.headers['x-organization-id']) tenant = String(req.headers['x-organization-id']);

    if (!tenant) {
      return res.status(400).json({ message: "Missing required 'organization_id' (or tenant_id/x-organization-id)." });
    }

    // Compute UTC window
    const now = new Date(); // UTC reference
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const startOfUTCDate = (d) => new Date(`${toYMD(d)}T00:00:00.000Z`);
    const endOfUTCDate = (d) => new Date(`${toYMD(d)}T23:59:59.999Z`);
    const startOfUTCMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));

    let windowStart;
    let windowEnd;

    if (range === 'daily') {
      // Today 00:00:00 to 23:59:59 UTC
      windowStart = startOfUTCDate(now);
      windowEnd = endOfUTCDate(now);
    } else if (range === 'weekly') {
      // Last complete 7 days (excluding today): [today-7, today-1] inclusive
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999));
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7, 0, 0, 0, 0));
      windowStart = start;
      windowEnd = end;
    } else if (range === 'monthly') {
      // Current month-to-date
      const start = startOfUTCMonth(now);
      const end = endOfUTCDate(now);
      windowStart = start;
      windowEnd = end;
    } else if (range === 'custom') {
      // Validate custom dates
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!start_date || !end_date || !re.test(start_date) || !re.test(end_date)) {
        return res.status(400).json({ message: "For range=custom, 'start_date' and 'end_date' are required in YYYY-MM-DD." });
      }
      windowStart = new Date(`${start_date}T00:00:00.000Z`);
      windowEnd = new Date(`${end_date}T23:59:59.999Z`);
      if (isNaN(windowStart.getTime()) || isNaN(windowEnd.getTime())) {
        return res.status(400).json({ message: 'Invalid start_date or end_date.' });
      }
      if (windowStart > windowEnd) {
        return res.status(400).json({ message: 'start_date must be before or equal to end_date.' });
      }
    }

    // Build match filter
    const match = {
      organization_id: tenant,
      created_at: {
        $gte: windowStart,
        $lte: windowEnd,
      },
    };

    // Determine bucketing
    // Use $dateTrunc if available via server version; fall back to $dateToString keys
    // We'll use $dateToString for compatibility and compute labels accordingly.
    let groupIdExpr;
    let labelFormatter;
    let startEndComputer;

    if (range === 'daily' || range === 'custom') {
      // Bucket by day
      groupIdExpr = {
        $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' },
      };
      labelFormatter = (key) => key; // YYYY-MM-DD
      startEndComputer = (key) => {
        const start = new Date(`${key}T00:00:00.000Z`);
        const end = new Date(`${key}T23:59:59.999Z`);
        return { start: start.toISOString(), end: end.toISOString() };
      };
    } else if (range === 'weekly') {
      // Use ISO week label: YYYY-[W]WW
      // Compute ISO week year-week via dateToString of week start (Monday) approximation:
      // We'll group by year-week using $dateToString on %G-%V per Mongo 5.0+ (not supported). Fallback: compute Monday by $dateSubtract from $dayOfWeek.
      // Reliable cross-version approach: $dateToString with '%Y-%m-%d' on date truncated to week using $dateTrunc when available is ideal, but we fallback by computing YYYY-WW in JS after grouping by day, then re-aggregating in memory.
      // To avoid multi-pass, we approximate weekly using $dateToString with ISO week via $isoWeekYear and $isoWeek if supported. Use $dateToParts with isoWeekYear/isoWeek.
      groupIdExpr = {
        $concat: [
          { $toString: { $isoWeekYear: '$created_at' } },
          '-W',
          {
            $let: {
              vars: { w: { $isoWeek: '$created_at' } },
              in: {
                $cond: [
                  { $lt: ['$$w', 10] },
                  { $concat: ['0', { $toString: '$$w' }] },
                  { $toString: '$$w' },
                ],
              },
            },
          },
        ],
      };
      labelFormatter = (key) => key; // YYYY-WWW
      // Start/end for ISO week: compute Monday 00:00:00 to Sunday 23:59:59 UTC
      startEndComputer = (key) => {
        const m = /^(\d{4})-W(\d{2})$/.exec(key);
        if (!m) return { start: windowStart.toISOString(), end: windowEnd.toISOString() };
        const year = parseInt(m[1], 10);
        const week = parseInt(m[2], 10);
        // ISO week: week 1 is the one with the year's first Thursday.
        // Compute date of Monday of that ISO week:
        const simple = new Date(Date.UTC(year, 0, 4)); // Jan 4th
        const dayOfWeek = (simple.getUTCDay() + 6) % 7; // 0=Mon
        const mondayOfWeek1 = new Date(Date.UTC(year, 0, 4 - dayOfWeek));
        const start = new Date(mondayOfWeek1);
        start.setUTCDate(start.getUTCDate() + (week - 1) * 7);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 6);
        const startISO = new Date(`${toYMD(start)}T00:00:00.000Z`);
        const endISO = new Date(`${toYMD(end)}T23:59:59.999Z`);
        return { start: startISO.toISOString(), end: endISO.toISOString() };
      };
    } else if (range === 'monthly') {
      groupIdExpr = {
        $dateToString: { format: '%Y-%m', date: '$created_at', timezone: 'UTC' },
      };
      labelFormatter = (key) => key; // YYYY-MM
      startEndComputer = (key) => {
        const m = /^(\d{4})-(\d{2})$/.exec(key);
        if (!m) return { start: windowStart.toISOString(), end: windowEnd.toISOString() };
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
        const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // last day of month
        return { start: start.toISOString(), end: end.toISOString() };
      };
    }

    const db = req.app.get('db');
    const users = db.collection('users');

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: groupIdExpr,
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          key: '$_id',
          count: 1,
        },
      },
    ];

    const results = await users.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Map to required bins with label, and attach start/end per bucket
    const bins = results.map((r) => {
      const label = labelFormatter(r.key);
      const { start, end } = startEndComputer(r.key);
      return { label, count: r.count, start, end };
    });

    return res.status(200).json({
      range,
      start_date: toYMD(windowStart),
      end_date: toYMD(windowEnd),
      bins,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error in /api/users/summary:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
