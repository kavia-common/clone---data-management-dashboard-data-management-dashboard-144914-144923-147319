'use strict';

const SessionTracking = require('../models/sessionTracking.model');
const User = require('../models/user.model');

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
 * Bounded promise helper with timeout to avoid hangs from downstream layers.
 */
async function withTimeout(promise, ms, label = 'op') {
  let timeoutId;
  const to = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
  });
  try {
    const result = await Promise.race([promise, to]);
    clearTimeout(timeoutId);
    return result;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

/**
 * Note on stability and cancellation prevention:
 * - Always send a single response path: return after res.json/res.status(...).json.
 * - Guard against unresolved promises by setting sane defaults and ensuring awaits are bounded to our own async operations only.
 * - Avoid throwing from downstream helpers by catching and defaulting to null/[].
 * - Add lightweight logging breadcrumbs to trace flow without excessive noise.
 */
/**
 * PUBLIC_INTERFACE
 * getProjectCreateSummary
 * Now resolves and returns user_name from a provided user_id. AppDeployment and project lookups removed.
 * - Accepts user_id from req.body or req.query (supports both).
 * - Looks up Users collection to fetch displayable name: name|displayName|display_name|full_name|username|email|user_name.
 * - If not found, user_name is null.
 * - Preserves existing tenant/date handling for stability; aggregation switched to user_id counts within window.
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

    // Accept user_id from body or query, normalize to string
    const user_id_raw =
      (req.body && (req.body.user_id ?? req.body.userId)) ||
      req.query.user_id ||
      req.query.userId ||
      null;
    const user_id = user_id_raw != null ? String(user_id_raw) : null;

    // Resolve user_name (non-fatal, bounded)
    let user_name = null;
    if (user_id) {
      try {
        const query = {
          $or: [
            { _id: user_id }, // string match; we avoid ObjectId conversion to prevent cast errors with non-hex ids
            { id: user_id },
            { user_id: user_id },
            { username: user_id },
            { email: user_id },
          ],
        };
        const projection = {
          name: 1,
          displayName: 1,
          display_name: 1,
          full_name: 1,
          fullName: 1,
          username: 1,
          user_name: 1,
          email: 1,
        };
        const u = await withTimeout(User.findOne(query, projection).lean(), 2000, 'userLookup');
        if (u) {
          user_name =
            u.name ||
            u.displayName ||
            u.display_name ||
            u.full_name ||
            u.fullName ||
            u.username ||
            u.user_name ||
            u.email ||
            null;
          if (user_name != null) user_name = String(user_name);
        } else {
          user_name = null;
        }
      } catch (e) {
        try { console.warn('[project-create] user lookup failed:', e?.message || e); } catch {}
        user_name = null;
      }
    }

    // Always include buckets for backward compatibility; compute when tenant provided
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

      // Aggregate by user_id from SessionTracking; ensure user_id exists to avoid null grouping noise
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
              { user_id: { $exists: true, $ne: null, $ne: '' } },
            ],
          },
        },
        {
          $group: {
            _id: { $toString: '$user_id' },
            user_id: { $first: { $toString: '$user_id' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ];

      let results = [];
      try {
        results = await withTimeout(
          SessionTracking.aggregate(pipeline).allowDiskUse(true),
          4000,
          'sessionTrackingAggregate'
        );
      } catch (e) {
        try {
          console.warn('[project-create] aggregation failed:', e.message || e);
        } catch {}
        res.set('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true,
          buckets: [],
          diagnostics: { note: 'aggregation_failed', message: e?.message || String(e) },
          ...(user_id ? { user_id, user_name } : {}),
        });
      }

      // Resolve names for the bucket users (best-effort; time-bounded)
      const ids = Array.isArray(results) ? results.map(r => r?.user_id).filter(Boolean).map(String) : [];
      let nameById = new Map();
      if (ids.length > 0) {
        try {
          // Query Users in one go using $in across multiple fields by $or
          const users = await withTimeout(
            User.find(
              {
                $or: [
                  { _id: { $in: ids } },
                  { id: { $in: ids } },
                  { user_id: { $in: ids } },
                  { username: { $in: ids } },
                  { email: { $in: ids } },
                ],
              },
              {
                name: 1,
                displayName: 1,
                display_name: 1,
                full_name: 1,
                fullName: 1,
                username: 1,
                user_name: 1,
                email: 1,
                _id: 1,
                id: 1,
                user_id: 1,
              }
            ).lean(),
            2500,
            'usersBulkLookup'
          );

          // Build a map using multiple potential keys to maximize matches
          nameById = new Map();
          const pickName = (u) =>
            u?.name ||
            u?.displayName ||
            u?.display_name ||
            u?.full_name ||
            u?.fullName ||
            u?.username ||
            u?.user_name ||
            u?.email ||
            null;

          for (const u of users || []) {
            const n = pickName(u);
            const keys = [
              u?._id != null ? String(u._id) : null,
              u?.id != null ? String(u.id) : null,
              u?.user_id != null ? String(u.user_id) : null,
              u?.username != null ? String(u.username) : null,
              u?.email != null ? String(u.email) : null,
            ].filter(Boolean);
            for (const k of keys) {
              if (!nameById.has(k)) nameById.set(k, n);
            }
          }
        } catch (e) {
          try { console.warn('[project-create] users bulk name lookup failed:', e?.message || e); } catch {}
          nameById = new Map();
        }
      }

      buckets = results.map((r) => {
        const uid = r?.user_id != null ? String(r.user_id) : '';
        const uname = nameById.get(uid) ?? null;
        return {
          key: uid,
          user_id: uid,
          user_name: uname,
          label: uname || uid,
          count: r?.count ?? 0,
        };
      });
    }

    const payload = { success: true, buckets };
    if (user_id) {
      payload.user_id = user_id;
      payload.user_name = user_name;
    }

    res.set('Cache-Control', 'no-store');
    res.set('x-project-create-ms', String(Date.now() - t0));
    if (tenant) res.set('x-project-create-tenant', String(tenant));
    if (user_id) res.set('x-user-id', String(user_id));
    return res.status(200).json(payload);
  } catch (err) {
    try { console.warn('[project-create] unhandled error:', err?.message || err); } catch {}
    try {
      return res.status(500).json({ success: false, error: 'Internal server error' });
    } catch {
      if (typeof next === 'function') return next(err);
    }
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getProjectCreateSummary,
};
