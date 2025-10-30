const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { parseISO, startOfDay, startOfWeek, startOfMonth, formatISO, addDays, addWeeks, addMonths } = require('date-fns');

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
  // time range filter is applied on activityTs (updated_at || created_at) later in pipeline
  return match;
}

/**
 * Helper: date bucketer
 */
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
  /**
   * Returns:
   * { items: [{ date: 'YYYY-MM-DD', total: number }], meta: { granularity, from, to } }
   */
  try {
    const db = getDb();
    const users = db.collection('users');

    const { from, to, granularity } = parseRange(req.query);
    const match = buildUsersMatch(req.query);

    // Only active users when status filter not given? Spec says Active users = status == 'active'.
    // We will respect explicit status filter; otherwise default to active
    if (!req.query.status) {
      match.status = 'active';
    }

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          activityTs: { $ifNull: ['$updated_at', '$created_at'] }
        }
      },
      {
        $match: {
          activityTs: { $gte: from, $lte: to }
        }
      },
      {
        $group: {
          _id: {
            bucket: {
              $dateTrunc: {
                date: '$activityTs',
                unit: granularity,
                binSize: 1
              }
            }
          },
          userIds: { $addToSet: '$_id' }
        }
      },
      {
        $project: {
          _id: 0,
          date: '$_id.bucket',
          total: { $size: '$userIds' }
        }
      },
      { $sort: { date: 1 } }
    ];

    const rows = await users.aggregate(pipeline).toArray();

    // Fill missing buckets
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

    res.json({
      items,
      meta: {
        granularity,
        from: from.toISOString(),
        to: to.toISOString()
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('active-trend error', err);
    res.status(500).json({ error: 'Failed to compute active trend' });
  }
});

module.exports = router;
