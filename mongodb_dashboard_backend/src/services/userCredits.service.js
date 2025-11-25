'use strict';

const { getCollection } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * getTotalsForUsers
 * Computes total credits (sum of costs) from the 'llm-costs' collection for a given tenant across a list of user ids.
 *
 * Notes:
 * - We use the 'total_cost' field from llm-costs as the credits source. If your dataset uses a different field
 *   (e.g., 'credits' or 'amount'), change the COST_FIELD const below accordingly.
 * - We coerce values to double and guard against non-numeric/undefined values with onError/onNull = 0.
 * - We compare user_id by coercing to string with $toString to match Users' _id string.
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

  // Normalize to string for matching with $toString(user_id)
  const idSet = Array.from(new Set(userIds.map((id) => String(id))));

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
            $expr: { $in: [{ $toString: '$user_id' }, idSet] },
          },
        ],
      },
    },
    {
      $project: {
        _id: 0,
        user_id_str: { $toString: '$user_id' },
        total_cost_num: {
          $convert: {
            input: {
              $cond: [{ $isNumber: COST_FIELD }, COST_FIELD, { $toString: COST_FIELD }],
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
    const uid = String(d.user_id);
    const val = Number(d.total_credits || 0);
    result.set(uid, val);
  }

  // Ensure all requested ids exist in map with 0 when missing
  for (const uid of idSet) {
    if (!result.has(uid)) result.set(uid, 0);
  }
  return result;
}

module.exports = { getTotalsForUsers };
