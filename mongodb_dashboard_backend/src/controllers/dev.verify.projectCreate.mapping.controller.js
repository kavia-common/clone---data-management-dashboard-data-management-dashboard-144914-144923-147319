'use strict';

const SessionTracking = require('../models/sessionTracking.model');

/**
 * PUBLIC_INTERFACE
 * mappingDiagnostics
 * Returns mapping diagnostics: how many sessionTracking documents (in strict window and tenant/project filters)
 * have a user_id that can be joined to users via _id, user_id, or email.
 * The join is computed fully inside Mongo via $lookup to avoid N+1.
 *
 * Query:
 *  - tenant_id | organization_id | x-organization-id (required for strict scope)
 *  - project_id (optional, exact match)
 *  - range=daily|weekly|monthly|custom (default daily)
 *  - start_date, end_date (YYYY-MM-DD, required when range=custom)
 *
 * Response: { ok: true, totalSessions: n, matchedUsers: n, unmatched: n, sample: [..], window: { from,to }, project_id? }
 */
async function mappingDiagnostics(req, res) {
  try {
    const { range = 'daily', start_date, end_date } = req.query;
    const tenant =
      req.query.tenant_id ||
      req.query.organization_id ||
      req.headers['x-organization-id'] ||
      null;

    if (!tenant) {
      return res.status(200).json({ ok: true, note: 'no-tenant', totalSessions: 0, matchedUsers: 0, unmatched: 0, sample: [] });
    }

    function parseCustomDateWindow(startStr, endStr) {
      if (!startStr || !endStr) return { error: 'start_date and end_date required' };
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!re.test(startStr) || !re.test(endStr)) return { error: 'invalid date format' };
      const from = new Date(`${startStr}T00:00:00.000Z`);
      const to = new Date(`${endStr}T23:59:59.999Z`);
      return { from, to };
    }
    function deriveWindowFromRange(rng) {
      const now = new Date();
      const sod = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0,0,0,0));
      if (rng === 'weekly') {
        const day = sod.getUTCDay();
        const diff = (day + 6) % 7;
        const from = new Date(sod); from.setUTCDate(from.getUTCDate() - diff);
        const to = new Date(from); to.setUTCDate(to.getUTCDate() + 6); to.setUTCHours(23,59,59,999);
        return { from, to };
      }
      if (rng === 'monthly') {
        const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1,0,0,0,0));
        const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23,59,59,999));
        return { from, to };
      }
      // daily default
      return { from: sod, to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23,59,59,999)) };
    }

    let windowFrom, windowTo;
    if (range === 'custom') {
      const parsed = parseCustomDateWindow(start_date, end_date);
      if (parsed.error) {
        return res.status(200).json({ ok: true, note: parsed.error, totalSessions: 0, matchedUsers: 0, unmatched: 0, sample: [] });
      }
      windowFrom = parsed.from; windowTo = parsed.to;
    } else {
      const d = deriveWindowFromRange(range);
      windowFrom = d.from; windowTo = d.to;
    }

    const project_id =
      req.query.project_id != null ? String(req.query.project_id) : null;

    const strictMatch = {
      tenant_id: String(tenant),
      created_at: { $gte: windowFrom, $lte: windowTo },
      ...(project_id ? { project_id: String(Number(project_id)) === project_id ? String(Number(project_id)) : String(project_id) } : {}),
    };

    const pipeline = [
      { $match: strictMatch },
      {
        $addFields: {
          user_id_str: { $cond: [{ $ifNull: ['$user_id', false] }, { $toString: '$user_id' }, ''] },
        },
      },
      {
        $addFields: {
          user_oid_maybe: {
            $cond: [
              { $regexMatch: { input: '$user_id_str', regex: /^[a-fA-F0-9]{24}$/ } },
              { $toObjectId: '$user_id_str' },
              null,
            ],
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          let: { uid_str: '$user_id_str', uid_oid: '$user_oid_maybe' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $and: [{ $ne: ['$$uid_oid', null] }, { $eq: ['$_id', '$$uid_oid'] }] },
                    { $eq: ['$user_id', '$$uid_str'] },
                    { $eq: ['$email', '$$uid_str'] },
                  ],
                },
              },
            },
            { $project: { _id: 1 } },
          ],
          as: 'u',
        },
      },
      {
        $project: {
          _id: 1,
          user_id: '$user_id_str',
          matched: { $gt: [{ $size: '$u' }, 0] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          matched: { $sum: { $cond: ['$matched', 1, 0] } },
          sample: { $push: { user_id: '$user_id', matched: '$matched' } },
        },
      },
      {
        $project: {
          _id: 0,
          total: 1,
          matched: 1,
          unmatched: { $subtract: ['$total', '$matched'] },
          sample: { $slice: ['$sample', 10] },
        },
      },
    ];

    const docs = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
    const summary = docs[0] || { total: 0, matched: 0, unmatched: 0, sample: [] };

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      totalSessions: summary.total,
      matchedUsers: summary.matched,
      unmatched: summary.unmatched,
      sample: summary.sample,
      window: { from: windowFrom.toISOString(), to: windowTo.toISOString() },
      ...(project_id ? { project_id } : {}),
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  mappingDiagnostics,
};
