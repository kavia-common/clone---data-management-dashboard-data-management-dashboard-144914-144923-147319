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

// PUBLIC_INTERFACE
/**
 * Aggregates SessionTracking by project_id within requested window and tenant scope.
 * If organization_id (from header or query) is 'T0000', groups by organization_id with a sensible maxTimeMS and robust error handling,
 * always guarantees a response for every path, and logs debug info at entry/exit.
 */
async function getProjectCreateSummary(req, res, next) {
  const t0 = Date.now();
  let didRespond = false;
  const debug = (...args) => console.debug('[projectCreateSummary.controller]', ...args);

  debug('Handler entry', { path: req.path, method: req.method });

  try {
    const { range = 'daily', start_date, end_date } = req.query;

    // Extract effective organization_id robustly
    let effectiveOrg =
      req.headers['x-organization-id'] ||
      req.query.organization_id ||
      req.query.tenant_id ||
      req.query.organizationId ||
      req.query.tenantId ||
      null;
    // If both header and query are specified and differ, prefer header
    if (
      req.headers['x-organization-id'] &&
      req.query.organization_id &&
      req.headers['x-organization-id'] !== req.query.organization_id
    ) {
      effectiveOrg = req.headers['x-organization-id'];
    }

    // Accept project_id as legacy/compat
    const project_id =
      (req.body && (req.body.project_id ?? req.body.projectId)) ||
      req.query.project_id ||
      req.query.projectId ||
      null;

    // Pick window
    let windowFrom, windowTo;
    const resolveWindow = () => {
      if (range === 'custom') {
        const parsed = parseCustomDateWindow(start_date, end_date);
        if (parsed.error) {
          return { error: parsed.error };
        }
        return { from: parsed.from, to: parsed.to };
      }
      return deriveWindowFromRange(range);
    };
    const w = resolveWindow();
    if (w.error) {
      res.set('Cache-Control', 'no-store');
      debug('Window parse error', w.error);
      didRespond = true;
      return res.status(400).json({ error: w.error });
    }
    windowFrom = w.from;
    windowTo = w.to;

    const isT0000 = (effectiveOrg || '').toUpperCase() === 'T0000';

    // Build project_id filter
    const projectIdFilter = {};
    if (project_id !== null && project_id !== undefined && project_id !== '') {
      projectIdFilter.project_id = String(project_id);
    }

    if (isT0000) {
      // T0000: group across ALL orgs within window
      debug('T0000 detected, running aggregation by organization_id');
      const matchAll = {
        created_at: { $gte: windowFrom, $lte: windowTo },
        ...(Object.keys(projectIdFilter).length ? projectIdFilter : { project_id: { $exists: true } }),
      };
      const pipelineT0000 = [
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
        {
          $group: {
            _id: '$_org',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
        {
          $project: {
            _id: 0,
            organization_id: '$_id',
            count: 1,
          },
        },
      ];

      try {
        const result = await SessionTracking.aggregate(pipelineT0000)
          .option({ maxTimeMS: 4000 })
          .allowDiskUse(true);
        res.set('x-project-create-ms', String(Date.now() - t0));
        res.set('x-project-create-tenant', 'T0000');
        res.set('x-project-create-from', windowFrom.toISOString());
        res.set('x-project-create-to', windowTo.toISOString());
        res.set('Cache-Control', 'no-store');
        didRespond = true;
        debug('Aggregation success. Count:', result.length, 'Handler exit (T0000)');
        return res.status(200).json(result || []);
      } catch (aggErr) {
        if (
          aggErr &&
          typeof aggErr === 'object' &&
          (aggErr.code === 50 || String(aggErr.message || '').includes('exceeded time limit'))
        ) {
          didRespond = true;
          debug('Aggregation timed out', aggErr.message);
          return res.status(503).json({ error: 'Timed out (maxTimeMS exceeded)' });
        }
        try {
          console.warn('[project-create.summary T0000] aggregation error:', aggErr?.message || aggErr);
        } catch {}
        didRespond = true;
        debug('Aggregation error', aggErr?.message || String(aggErr));
        return res.status(500).json({ error: 'Internal server error' });
      }
    }

    // Non-T0000: original behavior - group within tenant (organization)
    const strictMatch = {
      tenant_id: effectiveOrg ? String(effectiveOrg) : null,
      created_at: { $gte: windowFrom, $lte: windowTo },
      ...(Object.keys(projectIdFilter).length ? projectIdFilter : { project_id: { $exists: true } }),
    };

    if (!strictMatch.tenant_id) {
      res.set('Cache-Control', 'no-store');
      debug('No tenant_id provided for summary');
      didRespond = true;
      return res.status(400).json({ error: 'organization_id (or tenant_id/x-organization-id) is required' });
    }

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
      results = await SessionTracking.aggregate(pipeline)
        .option({ maxTimeMS: 4000 })
        .allowDiskUse(true);
    } catch (e) {
      try { console.warn('[project-create] aggregation failed:', e?.message || e); } catch {}
      res.set('Cache-Control', 'no-store');
      didRespond = true;
      debug('Aggregation failed (non-T0000)', e?.message || String(e));
      return res.status(200).json({
        success: true,
        buckets: [],
        diagnostics: { note: 'aggregation_failed', message: e?.message || String(e) },
        ...(project_id ? { project_id: String(project_id) } : {}),
      });
    }

    const buckets = (results || []).map((r) => {
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

    const payload = { success: true, buckets };
    if (project_id) payload.project_id = String(project_id);

    res.set('Cache-Control', 'no-store');
    res.set('x-project-create-ms', String(Date.now() - t0));
    res.set('x-project-create-tenant', String(effectiveOrg));
    res.set('x-project-create-from', windowFrom.toISOString());
    res.set('x-project-create-to', windowTo.toISOString());
    didRespond = true;
    debug('Handler exit (non-T0000)');
    return res.status(200).json(payload);
  } catch (err) {
    try { console.warn('[project-create] unhandled error:', err?.message || err); } catch {}
    try {
      if (!didRespond) {
        debug('Fallback handler (error path)');
        return res.status(500).json({ error: 'Internal server error' });
      }
    } catch {
      if (typeof next === 'function') return next(err);
    }
  }
  // Defensive fallback in case all above fails (must respond)
  if (!didRespond) {
    try { 
      debug('Final fallback: no response sent');
      res.status(500).json({ error: 'Server did not respond in time' }); 
    } catch {}
  }
}

module.exports = {
  getProjectCreateSummary,
};
