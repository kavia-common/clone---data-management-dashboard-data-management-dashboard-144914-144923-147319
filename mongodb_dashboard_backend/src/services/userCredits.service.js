'use strict';

const { getCollection } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * getTotalsForUsers
 * Computes total credits (sum of costs) from the 'llm-costs' collection for a given tenant across a list of user ids.
 *
 * Logic:
 * - Enforce tenant scope by matching any of the tenant alias fields to tenantId.
 * - Consider both:
 *    a) top-level user_id field
 *    b) embedded users array entries where users[].user_id matches.
 * - Cost value derivation (numeric-safe):
 *    • Prefer numeric total_cost when present.
 *    • Else, attempt to parse string currency-formatted total_cost like "$1244.515433".
 *    • Else, check embedded users[].user_cost and parse/convert similarly.
 * - Sum costs per matched user id (normalized to string).
 * - Null-safe defaults: return 0 when no costs found for a user.
 *
 * @param {string} tenantId - Tenant/organization identifier to scope aggregation
 * @param {Array<string>} userIds - List of user ids (as strings) to aggregate
 * @returns {Promise<Map<string, number>>} Map of userId => total_credits
 */
async function getTotalsForUsers(tenantId, userIds) {
  if (!tenantId || !Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const col = await getCollection(['llm-costs', 'llm_costs']);

  // Normalize to unique string ids
  const idSet = Array.from(new Set(userIds.map((id) => String(id))));

  // Pipeline:
  // 1) Match tenant by aliases
  // 2) Filter documents where:
  //    - top-level user_id is in requested ids OR
  //    - any users[].user_id in requested ids
  // 3) Build two contribution streams:
  //    A) top-level: { user_id_str, cost_num }
  //    B) embedded users[]: unwind/transform only matching users, each yields { user_id_str, cost_num }
  // 4) Union both streams with $unionWith-style emulation via $facet and $project, then $group.
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
              { $expr: { $in: [{ $toString: '$user_id' }, idSet] } },
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
    {
      $facet: {
        topLevel: [
          {
            $project: {
              _id: 0,
              user_id_str: { $toString: '$user_id' },
              // Attempt numeric parse of total_cost; handles number or string like "$1,234.56"
              cost_num: {
                $let: {
                  vars: {
                    raw: '$total_cost',
                    rawStr: {
                      $trim: {
                        input: {
                          $replaceAll: {
                            input: { $replaceAll: { input: { $toString: { $ifNull: ['$total_cost', 0] } }, find: ',', replacement: '' } },
                            find: '$',
                            replacement: '',
                          },
                        },
                      },
                    },
                  },
                  in: {
                    $cond: [
                      { $isNumber: '$$raw' },
                      { $toDouble: '$$raw' },
                      {
                        $convert: {
                          input: '$$rawStr',
                          to: 'double',
                          onError: 0,
                          onNull: 0,
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
          {
            $match: {
              $and: [{ user_id_str: { $in: idSet } }],
            },
          },
        ],
        embedded: [
          {
            $project: {
              _id: 0,
              users: { $ifNull: ['$users', []] },
            },
          },
          { $unwind: '$users' },
          {
            $project: {
              user_id_str: { $toString: '$users.user_id' },
              cost_num: {
                $let: {
                  vars: {
                    raw: '$users.user_cost',
                    rawStr: {
                      $trim: {
                        input: {
                          $replaceAll: {
                            input: {
                              $replaceAll: {
                                input: { $toString: { $ifNull: ['$users.user_cost', 0] } },
                                find: ',',
                                replacement: '',
                              },
                            },
                            find: '$',
                            replacement: '',
                          },
                        },
                      },
                    },
                  },
                  in: {
                    $cond: [
                      { $isNumber: '$$raw' },
                      { $toDouble: '$$raw' },
                      {
                        $convert: {
                          input: '$$rawStr',
                          to: 'double',
                          onError: 0,
                          onNull: 0,
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
          { $match: { user_id_str: { $in: idSet } } },
        ],
      },
    },
    {
      // merge both arrays then group
      $project: {
        merged: { $concatArrays: ['$topLevel', '$embedded'] },
      },
    },
    { $unwind: '$merged' },
    {
      $group: {
        _id: '$merged.user_id_str',
        total_credits: { $sum: '$merged.cost_num' },
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
  for (const row of docs) {
    const uid = String(row?.user_id || '');
    const total = Number(row?.total_credits || 0);
    if (uid) result.set(uid, Number.isFinite(total) ? total : 0);
  }

  // Fill in zeros for users without any cost records
  for (const uid of idSet) {
    if (!result.has(uid)) result.set(uid, 0);
  }
  return result;
}

module.exports = { getTotalsForUsers };
