'use strict';

const { getNewUsersOverTime } = require('../services/analytics.users.newOverTime.service');

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/users/new-over-time
 * Returns new users count aggregated over time.
 * Query:
 *  - granularity=day|week|month (default day)
 *  - start=<ISO> & end=<ISO>
 *    Defaults:
 *      day: last 90 days
 *      week: last 26 weeks
 *      month: last 12 months
 * Response:
 * {
 *   granularity, start, end,
 *   points: [ { bucket: 'YYYY-MM-DD'|'YYYY-[W]WW'|'YYYY-MM', count: Number } ]
 * }
 */
async function newUsersOverTime(req, res) {
  try {
    const qGran = String((req.query.granularity || 'day')).toLowerCase();
    const granularity = ['day', 'week', 'month'].includes(qGran) ? qGran : 'day';

    // Default windows based on granularity if not provided
    const now = new Date();
    let startDefault;
    if (granularity === 'day') {
      startDefault = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (granularity === 'week') {
      startDefault = new Date(now.getTime() - 26 * 7 * 24 * 60 * 60 * 1000);
    } else {
      // month: approximate 12 months as 365 days for simplicity; visualization tolerant
      startDefault = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }

    const startStr = req.query.start || startDefault.toISOString();
    const endStr = req.query.end || now.toISOString();

    const start = new Date(startStr);
    const end = new Date(endStr);

    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "start" date' });
    }
    if (Number.isNaN(end.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "end" date' });
    }
    if (end < start) {
      return res.status(400).json({ success: false, message: '"end" must be after "start"' });
    }

    const result = await getNewUsersOverTime({ granularity, start, end });

    return res.status(200).json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/analytics/users/new-over-time failed:', err?.message || err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err?.message || 'Failed to compute new users over time',
    });
  }
}

module.exports = {
  newUsersOverTime,
};
