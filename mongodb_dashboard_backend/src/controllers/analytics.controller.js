'use strict';

const { ObjectId } = require('mongodb');

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/users/new-over-time
 * Returns new users count aggregated over time.
 *
 * Query params:
 * - from (optional ISO)
 * - to (optional ISO)
 * - granularity (optional): 'day' | 'week' | 'month'
 *
 * Behavior:
 * - If granularity is omitted, defaults to daily aggregation over the full available range.
 * - If from/to omitted, computes full available range from users.created_at.
 *
 * Response: { items: [{ date: 'YYYY-MM-DD', total: number }] }
 */
async function newUsersOverTime(req, res) {
  try {
    const db = req.app.get('db');
    const collection = db.collection('users');

    const { from, to } = req.query;
    let { granularity } = req.query;

    if (!granularity) {
      granularity = 'day';
    }
    if (granularity && !['day', 'week', 'month'].includes(granularity)) {
      return res.status(400).json({ success: false, message: 'invalid granularity: expected day|week|month' });
    }

    // Determine range from DB if not provided
    let start = from ? new Date(from) : null;
    let end = to ? new Date(to) : null;

    if (!start || !end) {
      const minMax = await collection
        .aggregate([
          {
            $group: {
              _id: null,
              min: { $min: '$created_at' },
              max: { $max: '$created_at' },
            },
          },
        ])
        .toArray();

      const min = minMax?.[0]?.min ? new Date(minMax[0].min) : new Date();
      const max = minMax?.[0]?.max ? new Date(minMax[0].max) : new Date();

      start = start || min;
      end = end || max;
    }

    // Make end exclusive by adding 1 day to include last bucket cleanly
    const endExclusive = new Date(end);
    endExclusive.setDate(endExclusive.getDate() + 1);

    const unit = granularity === 'day' ? 'day' : granularity === 'week' ? 'week' : 'month';

    const pipeline = [
      {
        $match: {
          created_at: { $gte: start, $lt: endExclusive },
        },
      },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$created_at',
              unit,
            },
          },
          total: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: { $dateToString: { format: '%Y-%m-%d', date: '$_id' } },
          total: 1,
        },
      },
    ];

    const items = await collection.aggregate(pipeline).toArray();

    return res.status(200).json({ items });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/analytics/users/new-over-time failed:', err?.message || err);
    const status = err?.status || 500;
    return res.status(status).json({
      success: false,
      message: err?.message || 'Failed to compute new users over time',
    });
  }
}

module.exports = {
  newUsersOverTime,
};
