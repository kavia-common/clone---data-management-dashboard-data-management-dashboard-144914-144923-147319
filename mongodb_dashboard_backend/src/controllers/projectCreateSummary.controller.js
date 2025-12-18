'use strict';

const SessionTracking = require('../models/sessionTracking.model');
const User = require('../models/user.model'); // for name lookup
const mongoose = require('mongoose');

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
 * Aggregates SessionTracking by project_id within requested window and tenant scope,
 * then looks up user names from Users collection using user_id (handles ObjectId|string).
 * Response returns user_name (string|null) as display label, includes project_id for verification,
 * and preserves strict UTC date bounds, tenant_id scope, and exact project_id filtering.
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

    // Accept project_id; preserved for strict exact match when provided
    const project_id =
      (req.body && (req.body.project_id ?? req.body.projectId)) ||
      req.query.project_id ||
      req.query.projectId ||
      null;

    let buckets = [];
    let windowFrom, windowTo;

    if (tenant) {
      // Determine date window
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

      // STRICT MATCH: created_at in UTC window, exact tenant, and exact project_id when provided.
      const projectIdFilter = {};
      if (project_id !== null && project_id !== undefined && project_id !== '') {
        const numMaybe = Number(project_id);
        if (!Number.isNaN(numMaybe) && String(numMaybe) === String(project_id)) {
          projectIdFilter.project_id = String(numMaybe);
        } else {
          projectIdFilter.project_id = String(project_id);
        }
      }

      const strictMatch = {
        tenant_id: String(tenant),
        created_at: { $gte: windowFrom, $lte: windowTo },
        ...(Object.keys(projectIdFilter).length ? projectIdFilter : { project_id: { $exists: true } }),
      };

      const pipeline = [
        { $match: strictMatch },
        {
          $group: {
            _id: { $ifNull: [{ $toString: '$project_id' }, '' ] },
            project_id: { $first: { $ifNull: [{ $toString: '$project_id' }, '' ] } },
            user_id: { $first: { $ifNull: [{ $toString: '$user_id' }, '' ] } },
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
          ...(project_id ? { project_id: String(project_id) } : {}),
        });
      }

      // Prepare userId list for lookup (filter out blanks)
      const userIds = Array.from(
        new Set(
          (results || [])
            .map(r => (r && r.user_id != null ? String(r.user_id) : ''))
            .filter(v => v !== '')
        )
      );

      // Build $or for _id and alternate keys; handle ObjectId and string forms.
      const orClauses = [];
      for (const uid of userIds) {
        // Try ObjectId if valid hex; otherwise use string-based fields
        if (mongoose.Types.ObjectId.isValid(uid)) {
          orClauses.push({ _id: new mongoose.Types.ObjectId(uid) });
        }
        // Also support legacy/custom string id fields
        orClauses.push({ user_id: uid });
        orClauses.push({ email: uid }); // sometimes user_id may be email
      }

      let usersByKey = new Map();
      if (orClauses.length > 0) {
        try {
          const userDocs = await User.find({ $or: orClauses })
            .select('_id name username displayName display_name full_name fullName user_name email user_id')
            .lean();
          for (const u of userDocs) {
            // Create multiple keys to maximize hit rate during mapping
            const keys = [];
            if (u._id) keys.push(String(u._id));
            if (u.user_id) keys.push(String(u.user_id));
            if (u.email) keys.push(String(u.email));
            // Choose best available display name
            const display =
              u.name ||
              u.displayName ||
              u.display_name ||
              u.full_name ||
              u.fullName ||
              u.user_name ||
              u.username ||
              null;
            for (const k of keys) {
              if (!usersByKey.has(k)) usersByKey.set(k, display);
            }
          }
          try {
            console.log('[project-create] users lookup: requested_ids=%d matched_docs=%d map_keys=%d',
              userIds.length, userDocs.length, usersByKey.size);
          } catch {}
        } catch (e) {
          // On lookup failure, proceed with null names deterministically
          try { console.warn('[project-create] users lookup failed:', e?.message || e); } catch {}
          usersByKey = new Map();
        }
      }

      // Map to response buckets replacing user_id with user_name while keeping project_id for verification
      buckets = (results || []).map((r) => {
        const rawUid = r?.user_id != null ? String(r.user_id) : '';
        const pid = r?.project_id != null ? String(r.project_id) : '';
        const resolvedName = rawUid ? (usersByKey.get(rawUid) ?? null) : null;

        return {
          key: resolvedName ?? rawUid,           // keep key stable for display; fallback to raw id if name missing
          user_name: resolvedName,               // requested: return name instead of user_id
          project_id: pid,                       // include project_id for verification
          label: resolvedName ?? rawUid,         // display label
          count: r?.count ?? 0,
        };
      });
    }

    // Deterministic 200 JSON response
    const payload = { success: true, buckets };
    if (project_id) {
      // top-level project_id for verification
      payload.project_id = String(project_id);
    }

    res.set('Cache-Control', 'no-store');
    res.set('x-project-create-ms', String(Date.now() - t0));
    if (tenant) res.set('x-project-create-tenant', String(tenant));
    if (project_id) res.set('x-project-id', String(project_id));
    if (typeof windowFrom !== 'undefined' && typeof windowTo !== 'undefined') {
      res.set('x-project-create-from', windowFrom.toISOString());
      res.set('x-project-create-to', windowTo.toISOString());
    }
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
