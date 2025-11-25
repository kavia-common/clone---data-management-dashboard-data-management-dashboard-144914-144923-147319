'use strict';

const { getCollection } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * getTotalsForUsers
 * Computes total credits (sum of costs) from the 'llm-costs' collection for a given tenant across a list of user ids.
 *
 * Enhancements:
 * - Aggregates credits from both:
 *    a) top-level user_id field
 *    b) embedded users array entries where users[].user_id matches the user's _id
 * - Uses $or match and $getField/$map to safely access array/object fields.
 * - Null-safe: defaults to 0 when no matches; non-numeric costs are treated as 0.
 *
 * Cost field preference:
 * - Prefer total_cost
 * - Fallbacks could be added here if needed (e.g., cost, credits), but we keep parity with existing schema.
 *
 * @param {string} tenantId - Tenant/organization identifier to scope aggregation
 * @param {Array<string>} userIds - List of user ids (as strings) to aggregate
 * @returns {Promise<Map<string, number>>} Map of userId => total_credits
 */
async function getTotalsForUsers(tenantId, userIds) {
  if (!tenantId || !Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  // Adjust this if your collection uses a different numeric field for cost/credits.
  const COST_FIELD = '$total_cost';

  const col = await getCollection(['llm-costs', 'llm_costs']);

  // Normalize to string for matching and dedupe inputs
  const idSet = Array.from(new Set(userIds.map((id) => String(id))));
  // Build a lookup set for faster $in checks in-memory later (Map result initialization ensures 0s)
  const requestedIds = new Set(idSet);

  // Pipeline that:
  // 1) Matches tenant by aliases
  // 2) Matches documents where either top-level user_id or any users[].user_id is in the requested set
  // 3) Derives a normalized userId for grouping:
  //    - user_id_str = $toString($ifNull(user_id, first users[].user_id that matches))
  // 4) Converts total_cost to double safely and sums by user_id_str
  const pipeline = [
    {
      $match: {
        $and: [
          {
            $or: [
              { tenant_id: String(tenantId) },
              { organization_id: String(tenantId) },
              { tenantId: String(tenantId) },
              { organizationId: String(tenantId) },
              { orgId: String(tenantId) },
              { 'tenant.tenant_id': String(tenantId) },
            ],
          },
          {
            $or: [
              // Top-level user_id in set
              { $expr: { $in: [{ $toString: '$user_id' }, idSet] } },
              // Any embedded users[].user_id in set
              {
                $expr: {
                  $gt: [
                    {
                      $size: {
                        $filter: {
                          input: { $ifNull: ['$users', []] },
                          as: 'u',
                          cond: { $in: [{ $toString: '$$u.user_id' }, idSet] },
                        },
                      },
                    },
                    0,
                  ],
                },
              },
            ],
          },
        ],
      },
    },
    // Project a unified user_id_str:
    // - Use top-level user_id when present in idSet
    // - Else, pick the first matching users[].user_id
    {
      $project: {
        _id: 0,
        _users_ids: {
          $map: {
            input: { $ifNull: ['$users', []] },
            as: 'u',
            in: { $toString: '$$u.user_id' },
          },
        },
        _top_user_id: { $toString: '$user_id' },
        // Keep raw cost for conversion below
        _raw_cost: COST_FIELD,
      },
    },
    {
      $addFields: {
        // Determine the normalized user id string
        user_id_str: {
          $let: {
            vars: {
              top: '$_top_user_id',
              arr: '$_users_ids',
            },
            in: {
              $cond: [
                { $and: [{ $ne: ['$$top', null] }, { $in: ['$$top', idSet] }] },
                '$$top',
                {
                  $let: {
                    vars: {
                      matches: {
                        $filter: {
                          input: { $ifNull: ['$$arr', []] },
                          as: 'id',
                          cond: { $in: ['$$id', idSet] },
                        },
                      },
                    },
                    in: {
                      $ifNull: [{ $arrayElemAt: ['$$matches', 0] }, '$$top'],
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    {
      $project: {
        user_id_str: 1,
        total_cost_num: {
          $convert: {
            input: {
              $cond: [
                { $isNumber: '$_raw_cost' },
                '$_raw_cost',
                { $toString: { $ifNull: ['$_raw_cost', 0] } },
              ],
            },
            to: 'double',
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    {
      $group: {
        _id: '$user_id_str',
        total_credits: { $sum: '$total_cost_num' },
      },
    },
    {
      $project: {
        _id: 0,
        user_id: '$_id',
        total_credits: 1,
      },
    },
  ];

  let docs = [];
  try {
    docs = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[userCredits.service] aggregation failed:', err?.message || err);
    return new Map();
  }

  const result = new Map();
  for (const d of docs) {
    const uid = String(d?.user_id ?? '');
    const val = Number(d?.total_credits ?? 0);
    if (uid) result.set(uid, val);
  }

  // Ensure all requested ids exist in map with 0 when missing
  for (const uid of requestedIds) {
    if (!result.has(uid)) result.set(uid, 0);
  }
  return result;
}

module.exports = { getTotalsForUsers };
