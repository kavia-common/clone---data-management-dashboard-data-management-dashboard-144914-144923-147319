'use strict';

const User = require('../models/user.model');

/**
 * PUBLIC_INTERFACE
 * getReferralSources
 * Handler: GET /api/users/referral-sources
 * Aggregates referral sources from users collection, unwinding referral_history when present,
 * or creating a synthetic entry per user inferred from referral_code. Supports optional
 * time bounds on referred_at (or created_at when history is missing) and returns top N sources.
 *
 * Query parameters:
 * - limit: number of top sources to return (default: 10, min: 1, max: 200)
 * - from: optional ISO date-time lower bound (applies to referred_at or created_at fallback)
 * - to: optional ISO date-time upper bound (applies to referred_at or created_at fallback)
 *
 * Response:
 * {
 *   items: [{ source: string, count: number }],
 *   totalSources: number
 * }
 */
async function getReferralSources(req, res) {
  try {
    // Validate and normalize query params
    const rawLimit = parseInt(req.query?.limit, 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 200)
      : 10;

    const fromStr = req.query?.from || null;
    const toStr = req.query?.to || null;

    const fromDate = fromStr ? new Date(fromStr) : null;
    const toDate = toStr ? new Date(toStr) : null;

    if (fromStr && Number.isNaN(fromDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "from" date' });
    }
    if (toStr && Number.isNaN(toDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "to" date' });
    }
    if (fromDate && toDate && toDate < fromDate) {
      return res.status(400).json({ success: false, message: '"to" must not be earlier than "from"' });
    }

    // Expression to compute a source string from referral_code (fallback when history.source not present)
    // Rules:
    //  - If 'src:XYZ' exists anywhere in referral_code, use XYZ up to first '-' if present (else full remainder)
    //  - Else if referral_code has 'XYZ-' prefix, use 'XYZ'
    //  - Else 'unknown'
    const sourceFromReferralCodeExpr = {
      $let: {
        vars: {
          rc: { $ifNull: ['$referral_code', ''] },
        },
        in: {
          $let: {
            vars: {
              srcIdx: { $indexOfBytes: ['$$rc', 'src:'] },
              dashIdx: { $indexOfBytes: ['$$rc', '-'] },
            },
            in: {
              $cond: [
                { $ne: ['$$srcIdx', -1] },
                {
                  $let: {
                    vars: {
                      afterSrc: {
                        $arrayElemAt: [{ $split: ['$$rc', 'src:'] }, 1],
                      },
                    },
                    in: {
                      $let: {
                        vars: {
                          token: {
                            $arrayElemAt: [{ $split: ['$$afterSrc', '-'] }, 0],
                          },
                        },
                        in: {
                          $cond: [
                            { $and: [{ $ne: ['$$token', null] }, { $ne: ['$$token', ''] }] },
                            '$$token',
                            'unknown',
                          ],
                        },
                      },
                    },
                  },
                },
                {
                  $cond: [
                    { $gt: ['$$dashIdx', -1] },
                    {
                      $let: {
                        vars: {
                          beforeDash: { $arrayElemAt: [{ $split: ['$$rc', '-'] }, 0] },
                        },
                        in: {
                          $cond: [
                            { $and: [{ $ne: ['$$beforeDash', null] }, { $ne: ['$$beforeDash', ''] }] },
                            '$$beforeDash',
                            'unknown',
                          ],
                        },
                      },
                    },
                    'unknown',
                  ],
                },
              ],
            },
          },
        },
      },
    };

    // Build pipeline:
    // 1. Prepare referral_history array and detect if present.
    // 2. Build "entries": either map referral_history items (with source fallback) or one synthetic entry from referral_code.
    // 3. Unwind/flatten entries.
    // 4. Optional date filtering on entries.referred_at (fallback to created_at when missing).
    // 5. Group by source and count, sort, limit. Also compute total distinct sources with $facet.
    const preFacetStages = [
      {
        $project: {
          referral_code: 1,
          created_at: 1,
          referral_history: { $ifNull: ['$referral_history', []] },
        },
      },
      {
        $addFields: {
          hasHistory: { $gt: [{ $size: '$referral_history' }, 0] },
        },
      },
      {
        $project: {
          entries: {
            $cond: [
              '$hasHistory',
              {
                $map: {
                  input: '$referral_history',
                  as: 'h',
                  in: {
                    source: {
                      $let: {
                        vars: { hs: '$$h.source' },
                        in: {
                          $cond: [
                            { $and: [{ $ne: ['$$hs', null] }, { $ne: ['$$hs', ''] }] },
                            '$$hs',
                            sourceFromReferralCodeExpr,
                          ],
                        },
                      },
                    },
                    referred_at: { $ifNull: ['$$h.referred_at', '$created_at'] },
                  },
                },
              },
              [
                {
                  source: sourceFromReferralCodeExpr,
                  referred_at: '$created_at',
                },
              ],
            ],
          },
        },
      },
      { $unwind: '$entries' },
      {
        $replaceRoot: { newRoot: '$entries' },
      },
    ];

    // Date bounds match (if provided)
    if (fromDate || toDate) {
      const referredAtCond = {};
      if (fromDate) referredAtCond.$gte = fromDate;
      if (toDate) referredAtCond.$lte = toDate;
      preFacetStages.push({
        $match: { referred_at: referredAtCond },
      });
    }

    const pipeline = [
      ...preFacetStages,
      {
        $project: {
          source: {
            $cond: [
              { $or: [{ $eq: ['$source', null] }, { $eq: ['$source', ''] }] },
              'unknown',
              '$source',
            ],
          },
        },
      },
      {
        $facet: {
          items: [
            { $group: { _id: '$source', count: { $sum: 1 } } },
            { $project: { _id: 0, source: '$_id', count: 1 } },
            { $sort: { count: -1, source: 1 } },
            { $limit: limit },
          ],
          totalSourcesAgg: [{ $group: { _id: '$source' } }, { $count: 'totalSources' }],
        },
      },
      {
        $project: {
          items: 1,
          totalSources: { $ifNull: [{ $arrayElemAt: ['$totalSourcesAgg.totalSources', 0] }, 0] },
        },
      },
    ];

    const result = await User.aggregate(pipeline).allowDiskUse(true);
    const doc = result?.[0] || { items: [], totalSources: 0 };

    return res.status(200).json({
      items: Array.isArray(doc.items) ? doc.items : [],
      totalSources: Number.isFinite(doc.totalSources) ? doc.totalSources : 0,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/users/referral-sources failed:', err?.message || err);
    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to aggregate referral sources',
    });
  }
}

module.exports = {
  getReferralSources,
};
