const express = require('express');
const router = express.Router();

/**
 * GET /api/users/summary
 * PUBLIC_INTERFACE
 * Users created summary by time buckets.
 * Query:
 *  - organization_id | tenant_id: optional; if missing, derived from auth (req.auth/req.user) or x-organization-id header.
 *  - range: daily|weekly|monthly|custom
 *  - start_date, end_date: YYYY-MM-DD when range=custom
 * Response:
 *  { buckets: [{ key, label, count }], range, start_date, end_date }
 */
router.get('/summary', async (req, res) => {
  try {
    const {
      organization_id,
      tenant_id,
      range = 'daily',
      start_date,
      end_date,
    } = req.query;

    // Derive tenant from query, auth or headers (x-organization-id)
    let tenant = organization_id || tenant_id;

    // Prefer authenticated request context if available (e.g., set by JWT middleware)
    const authTenant =
      (req.auth && (req.auth.tenantId || req.auth.organization_id || req.auth.organizationId)) ||
      (req.user && (req.user.tenantId || req.user.organization_id || req.user.organizationId));
    if (!tenant && authTenant) tenant = authTenant;

    // Allow header alias when no auth context is present
    if (!tenant && req.headers['x-organization-id']) {
      tenant = String(req.headers['x-organization-id']);
    }

    // Build match filter
    const match = {};
    if (tenant) {
      match.organization_id = tenant;
    }

    // Date window handling: for demo keep simple; in real impl, parse range/custom
    const now = new Date();
    let start = undefined;
    let end = undefined;
    if (range === 'custom') {
      start = start_date ? new Date(`${start_date}T00:00:00.000Z`) : undefined;
      end = end_date ? new Date(`${end_date}T23:59:59.999Z`) : undefined;
    } else if (range === 'daily') {
      const y = now.toISOString().slice(0, 10);
      start = new Date(`${y}T00:00:00.000Z`);
      end = new Date(`${y}T23:59:59.999Z`);
    }
    if (start || end) {
      match.created_at = {};
      if (start) match.created_at.$gte = start;
      if (end) match.created_at.$lte = end;
    }

    const db = req.app.get('db');
    const users = db.collection('users');

    // Simple aggregation: group by date (YYYY-MM-DD) for created_at
    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { date: '$created_at', format: '%Y-%m-%d', timezone: 'UTC' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          key: '$_id',
          label: '$_id',
          count: 1,
        },
      },
    ];

    const buckets = await users.aggregate(pipeline, { allowDiskUse: true }).toArray();

    return res.json({
      buckets,
      range,
      start_date: start_date || (start ? start.toISOString().slice(0, 10) : undefined),
      end_date: end_date || (end ? end.toISOString().slice(0, 10) : undefined),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error in /api/users/summary:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
