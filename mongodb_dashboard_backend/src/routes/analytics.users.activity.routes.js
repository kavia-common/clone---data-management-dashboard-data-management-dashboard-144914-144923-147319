const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { startOfDay, startOfWeek, startOfMonth, addDays, addWeeks, addMonths } = require('date-fns');

/**
 * Helper: parse date range and granularity
 */
function parseRange(query) {
  const now = new Date();
  const from = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = query.to ? new Date(query.to) : now;
  const granularity = ['day', 'week', 'month'].includes(query.granularity) ? query.granularity : 'day';
  return { from, to, granularity };
}

/**
 * Helper: build match filter from query for users collection
 */
function buildUsersMatch(query) {
  const match = {};
  if (query.status) match.status = query.status;
  if (query.department) match.department = query.department;
  if (query.organization_id) match.organization_id = query.organization_id;
  if (typeof query.is_admin !== 'undefined') {
    if (query.is_admin === 'true') match.is_admin = true;
    else if (query.is_admin === 'false') match.is_admin = false;
  }
  return match;
}

function getBoundaryFn(granularity) {
  switch (granularity) {
    case 'week': return startOfWeek;
    case 'month': return startOfMonth;
    default: return startOfDay;
  }
}
function getAdderFn(granularity) {
  switch (granularity) {
    case 'week': return addWeeks;
    case 'month': return addMonths;
    default: return addDays;
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/active-trend
 * Returns time-bucketed distinct count of active users using users.updated_at || users.created_at
 */
router.get('/active-trend', async (req, res) => {
  try {
    const db = getDb();
    const users = db.collection('users');

    const { from, to, granularity } = parseRange(req.query);
    const match = buildUsersMatch(req.query);
    if (!req.query.status) {
      match.status = 'active';
    }

    const pipeline = [
      { $match: match },
      { $addFields: { activityTs: { $ifNull: ['$updated_at', '$created_at'] } } },
      { $match: { activityTs: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: {
            bucket: {
              $dateTrunc: { date: '$activityTs', unit: granularity, binSize: 1 }
            }
          },
          userIds: { $addToSet: '$_id' }
        }
      },
      { $project: { _id: 0, date: '$_id.bucket', total: { $size: '$userIds' } } },
      { $sort: { date: 1 } }
    ];

    const rows = await users.aggregate(pipeline).toArray();

    const startFn = getBoundaryFn(granularity);
    const addFn = getAdderFn(granularity);
    let cursor = startFn(from);
    const end = to;
    const map = new Map(rows.map(r => [startFn(new Date(r.date)).toISOString().slice(0, 10), r.total]));

    const items = [];
    while (cursor <= end) {
      const key = startFn(cursor).toISOString().slice(0, 10);
      items.push({ date: key, total: map.get(key) || 0 });
      cursor = addFn(cursor, 1);
    }

    res.status(200).json({ items, meta: { granularity, from: from.toISOString(), to: to.toISOString() } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('active-trend error', err);
    res.status(500).json({ error: 'Failed to compute active trend' });
  }
});

/**
 * PUBLIC_INTERFACE
 * GET /api/users/kpi-summary
 * Returns KPI summary from users collection fields only.
 * Response: { items: [{ name, value }], meta?: {...} } (kept light)
 */
router.get('/kpi-summary', async (req, res) => {
  try {
    const db = getDb();
    const users = db.collection('users');

    const totalUsers = await users.countDocuments({});
    const activeUsers = await users.countDocuments({ status: 'active' });
    const admins = await users.countDocuments({ is_admin: true });

    res.status(200).json({
      items: [
        { name: 'Total Users', value: totalUsers },
        { name: 'Active Users', value: activeUsers },
        { name: 'Admins', value: admins }
      ]
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('kpi-summary error', err);
    res.status(500).json({ error: 'Failed to compute KPI summary' });
  }
});

/**
 * PUBLIC_INTERFACE
 * GET /api/users/by-department
 * Groups users by department with counts. Response: { items: [{ department, count }] }
 */
router.get('/by-department', async (req, res) => {
  try {
    const db = getDb();
    const users = db.collection('users');

    const pipeline = [
      { $group: { _id: { $ifNull: ['$department', 'Unknown'] }, count: { $sum: 1 } } },
      { $project: { _id: 0, department: '$_id', count: 1 } },
      { $sort: { count: -1, department: 1 } }
    ];

    const items = await users.aggregate(pipeline).toArray();
    res.status(200).json({ items });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('by-department error', err);
    res.status(500).json({ error: 'Failed to compute by-department' });
  }
});

/**
 * PUBLIC_INTERFACE
 * GET /api/users/by-organization
 * Groups users by organization_id with counts. Response: { items: [{ organization_id, count }] }
 */
router.get('/by-organization', async (req, res) => {
  try {
    const db = getDb();
    const users = db.collection('users');

    const pipeline = [
      { $group: { _id: { $ifNull: ['$organization_id', 'Unknown'] }, count: { $sum: 1 } } },
      { $project: { _id: 0, organization_id: '$_id', count: 1 } },
      { $sort: { count: -1, organization_id: 1 } }
    ];

    const items = await users.aggregate(pipeline).toArray();
    res.status(200).json({ items });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('by-organization error', err);
    res.status(500).json({ error: 'Failed to compute by-organization' });
  }
});

/**
 * PUBLIC_INTERFACE
 * GET /api/users/compliance
 * Returns a compliance breakdown derived from users fields.
 * Example buckets: profile/email present, phone present, has department set.
 * Response: { items: [{ name, count }] }
 */
router.get('/compliance', async (req, res) => {
  try {
    const db = getDb();
    const users = db.collection('users');

    const [emailSet, phoneSet, deptSet] = await Promise.all([
      users.countDocuments({ email: { $exists: true, $ne: '' } }),
      users.countDocuments({ contact_number: { $exists: true, $ne: '' } }),
      users.countDocuments({ department: { $exists: true, $ne: '' } }),
    ]);

    res.status(200).json({
      items: [
        { name: 'Email Set', count: emailSet },
        { name: 'Phone Set', count: phoneSet },
        { name: 'Department Set', count: deptSet },
      ]
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('compliance error', err);
    res.status(500).json({ error: 'Failed to compute compliance' });
  }
});

module.exports = router;
