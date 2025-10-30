const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');

/**
 * Build simple match for users based on filters
 */
function buildUsersMatch(query) {
  const match = {};
  if (query.department) match.department = query.department;
  if (query.organization_id) match.organization_id = query.organization_id;
  if (query.status) match.status = query.status;
  if (typeof query.is_admin !== 'undefined') {
    if (query.is_admin === 'true') match.is_admin = true;
    else if (query.is_admin === 'false') match.is_admin = false;
  }
  if (query.from || query.to) {
    const range = {};
    if (query.from) range.$gte = new Date(query.from);
    if (query.to) range.$lte = new Date(query.to);
    match.$expr = {
      $and: [
        {
          $gte: [
            { $ifNull: ['$updated_at', '$created_at'] },
            query.from ? new Date(query.from) : new Date(0)
          ]
        },
        {
          $lte: [
            { $ifNull: ['$updated_at', '$created_at'] },
            query.to ? new Date(query.to) : new Date()
          ]
        }
      ]
    };
  }
  return match;
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/kpi-summary
 */
router.get('/kpi-summary', async (req, res) => {
  try {
    const db = getDb();
    const users = db.collection('users');

    const match = buildUsersMatch(req.query);

    // Fetch totals
    const [
      totalUsers,
      activeUsers,
      adminUsers,
      departmentsAgg,
      organizationsAgg
    ] = await Promise.all([
      users.countDocuments(match),
      users.countDocuments({ ...match, status: req.query.status || 'active' }),
      users.countDocuments({ ...match, is_admin: true }),
      users.aggregate([{ $match: match }, { $group: { _id: '$department' } }, { $count: 'count' }]).toArray(),
      users.aggregate([{ $match: match }, { $group: { _id: '$organization_id' } }, { $count: 'count' }]).toArray()
    ]);

    const departmentsCount = departmentsAgg[0]?.count || 0;
    const organizationsCount = organizationsAgg[0]?.count || 0;
    const inactiveUsers = Math.max(totalUsers - activeUsers, 0);

    // Approximate dau/wau/mau using updated_at||created_at
    const now = new Date();
    const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const activityMatchBase = {
      ...match,
    };

    const buildActivityCount = async (start) => {
      const pipeline = [
        { $match: activityMatchBase },
        {
          $addFields: {
            activityTs: { $ifNull: ['$updated_at', '$created_at'] }
          }
        },
        { $match: { activityTs: { $gte: start } } },
        { $group: { _id: null, cnt: { $sum: 1 } } }
      ];
      const resArr = await users.aggregate(pipeline).toArray();
      return resArr[0]?.cnt || 0;
    };

    const [dau, wau, mau] = await Promise.all([
      buildActivityCount(dayStart),
      buildActivityCount(weekStart),
      buildActivityCount(monthStart),
    ]);

    res.json({
      totalUsers,
      activeUsers,
      inactiveUsers,
      adminUsers,
      departmentsCount,
      organizationsCount,
      dau,
      wau,
      mau
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
 */
router.get('/by-department', async (req, res) => {
  try {
    const db = getDb();
    const users = db.collection('users');
    const match = buildUsersMatch(req.query);

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$department', 'Unknown'] },
          count: { $sum: 1 }
        }
      },
      { $project: { _id: 0, department: '$_id', count: 1 } },
      { $sort: { count: -1 } }
    ];
    const items = await users.aggregate(pipeline).toArray();
    res.json({ items });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('by-department error', err);
    res.status(500).json({ error: 'Failed to aggregate by department' });
  }
});

/**
 * PUBLIC_INTERFACE
 * GET /api/users/by-organization
 */
router.get('/by-organization', async (req, res) => {
  try {
    const db = getDb();
    const users = db.collection('users');
    const match = buildUsersMatch(req.query);

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$organization_id', 'Unknown'] },
          count: { $sum: 1 }
        }
      },
      { $project: { _id: 0, organization_id: '$_id', count: 1 } },
      { $sort: { count: -1 } }
    ];
    const items = await users.aggregate(pipeline).toArray();
    res.json({ items });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('by-organization error', err);
    res.status(500).json({ error: 'Failed to aggregate by organization' });
  }
});

/**
 * PUBLIC_INTERFACE
 * GET /api/users/compliance
 * Derives:
 * - Email Present
 * - Contact Present (contact_number)
 * - Profile Complete (heuristic on required fields)
 */
router.get('/compliance', async (req, res) => {
  try {
    const db = getDb();
    const users = db.collection('users');
    const match = buildUsersMatch(req.query);

    // We'll compute three buckets using conditional sums
    const pipeline = [
      { $match: match },
      {
        $project: {
          emailPresent: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$email', '' ] } }, 0] }, 1, 0] },
          contactPresent: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$contact_number', '' ] } }, 0] }, 1, 0] },
          profileComplete: {
            $cond: [
              {
                $and: [
                  { $gt: [{ $strLenCP: { $ifNull: ['$email', '' ] } }, 0] },
                  { $ne: ['$status', null] },
                  { $ne: ['$department', null] },
                ]
              },
              1, 0
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          emailPresent: { $sum: '$emailPresent' },
          contactPresent: { $sum: '$contactPresent' },
          profileComplete: { $sum: '$profileComplete' }
        }
      }
    ];

    const rows = await users.aggregate(pipeline).toArray();
    const agg = rows[0] || { emailPresent: 0, contactPresent: 0, profileComplete: 0 };

    res.json({
      items: [
        { name: 'Email Present', count: agg.emailPresent },
        { name: 'Contact Present', count: agg.contactPresent },
        { name: 'Profile Complete', count: agg.profileComplete }
      ]
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('compliance error', err);
    res.status(500).json({ error: 'Failed to compute compliance' });
  }
});

module.exports = router;
