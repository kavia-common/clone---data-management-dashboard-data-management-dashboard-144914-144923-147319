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
 * then looks up user names via a $lookup aggregation to users to avoid N+1.
 * Response returns user_name (string|null), includes project_id for verification,
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

    // Determine date window only when we actually aggregate
    const resolveWindow = () => {
      if (range === 'custom') {
        const parsed = parseCustomDateWindow(start_date, end_date);
        if (parsed.error) {
          res.set('Cache-Control', 'no-store');
          return { error: parsed.error };
        }
        return { from: parsed.from, to: parsed.to };
      }
      const derived = deriveWindowFromRange(range);
      return { from: derived.from, to: derived.to };
    };

    // Resolve effective organization id from header/query as specified
    const effectiveOrg = tenant ? String(tenant) : null;
    const isT0000 = (effectiveOrg || '').toUpperCase() === 'T0000';

    if (isT0000) {
      // T0000 special-case: aggregate by organization across all tenants within window.
      // Minimal controller-scoped aggregation to avoid touching other services.
      // Response shape preserved: { success, buckets: [ { key, user_name, user_id, project_id, label, count } ] }
      const w = resolveWindow();
      if (w.error) {
        return res.status(400).json({ success: false, error: w.error });
      }
      windowFrom = w.from;
      windowTo = w.to;

      // Build match for all tenants, window bound on created_at and optional project_id exact if given.
      const projectIdFilter = {};
      if (project_id !== null && project_id !== undefined && project_id !== '') {
        const numMaybe = Number(project_id);
        projectIdFilter.project_id =
          !Number.isNaN(numMaybe) && String(numMaybe) === String(project_id)
            ? String(numMaybe)
            : String(project_id);
      }

      const matchAll = {
        created_at: { $gte: windowFrom, $lte: windowTo },
        ...(Object.keys(projectIdFilter).length ? projectIdFilter : { project_id: { $exists: true } }),
      };

      // Aggregate by tenant (organization) and project. Count records per organization.
      // We also $lookup users to preserve the response fields but we will map organization_id into label.
      const pipeline = [
        { $match: matchAll },
        {
          $addFields: {
            _org: {
              $ifNull: [
                '$tenant_id',
                { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', '$tenantId'] }] },
              ],
            },
          },
        },
        // Group by organization + project
        {
          $group: {
            _id: { org: '$_org', project_id: '$project_id' },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            organization_id: '$_id.org',
            project_id: '$_id.project_id',
            count: 1,
          },
        },
        { $sort: { count: -1, organization_id: 1 } },
      ];

      let results = [];
      try {
        results = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
      } catch (e) {
        try {
          console.warn('[project-create][T0000] aggregation failed:', e?.message || e);
        } catch {}
        res.set('Cache-Control', 'no-store');
        return res.status(200).json({
          success: true,
          buckets: [],
          diagnostics: { note: 'aggregation_failed_T0000', message: e?.message || String(e) },
          ...(project_id ? { project_id: String(project_id) } : {}),
        });
      }

      // Map: use organization_id as label/key; keep user fields present but null to preserve shape.
      buckets = (results || []).map((r) => {
        const org = r?.organization_id ? String(r.organization_id) : 'unknown';
        const pid = r?.project_id != null ? String(r.project_id) : '';
        return {
          key: org,                 // T0000: by-organization display key
          user_name: null,          // preserved field, not applicable in org grouping
          user_id: null,            // preserved field, not applicable in org grouping
          project_id: pid,
          label: org,
          count: r?.count ?? 0,
        };
      });

      // Headers for diagnostics
      res.set('x-project-create-tenant', 'all-tenants');
      res.set('x-special-case', 'T0000');
    } else if (effectiveOrg) {
      // Default path (unchanged): per-tenant aggregation resolving user names
      const w = resolveWindow();
      if (w.error) {
        res.set('Cache-Control', 'no-store');
        return res.status(400).json({ success: false, error: w.error });
      }
      windowFrom = w.from;
      windowTo = w.to;

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
        tenant_id: String(effectiveOrg),
        created_at: { $gte: windowFrom, $lte: windowTo },
        ...(Object.keys(projectIdFilter).length ? projectIdFilter : { project_id: { $exists: true } }),
      };

      // Use an aggregation pipeline that performs $lookup to users with robust id handling.
      const pipeline = [
        { $match: strictMatch },

        {
          $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: 'user_info',
          },
        },

        {
          $addFields: {
            user_name: {
              $ifNull: [{ $arrayElemAt: ['$user_info.name', 0] }, null],
            },
          },
        },

        {
          $group: {
            _id: '$project_id',
            project_id: { $first: '$project_id' },
            user_id: { $first: '$user_id' },
            user_name: { $first: '$user_name' },
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

      // Map to response buckets replacing user_id with user_name while keeping project_id for verification
      buckets = (results || []).map((r) => {
        const rawUid = r?.user_id != null ? String(r.user_id) : '';
        const pid = r?.project_id != null ? String(r.project_id) : '';
        const resolvedName = r?.user_name ?? null;

        return {
          key: resolvedName ?? rawUid,
          user_name: resolvedName,
          user_id: rawUid,
          project_id: pid,
          label: resolvedName ?? rawUid,
          count: r?.count ?? 0,
        };
      });
    } else {
      // No tenant provided: preserve previous deterministic 200 with empty buckets
      buckets = [];
    }

    // Deterministic 200 JSON response
    const payload = { success: true, buckets };
    if (project_id) {
      // top-level project_id for verification
      payload.project_id = String(project_id);
    }

    res.set('Cache-Control', 'no-store');
    res.set('x-project-create-ms', String(Date.now() - t0));
    if (tenant) res.set('x-project-create-tenant', isT0000 ? 'all-tenants' : String(tenant));
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
