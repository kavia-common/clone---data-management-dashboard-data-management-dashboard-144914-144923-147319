'use strict';

/**
 * Service to aggregate hierarchical LLM costs: user -> projects -> agents with per-date token and cost breakdowns.
 * Defensive in field naming: attempts to map differing schema keys where applicable.
 */

const { getDb } = require('../config/db');
const { usdToCredits } = require('../utils/credits');

// Resolve collection name with env override (default to underscore)
// Prefer LLMCOSTS_COLLECTION_NAME for consistency across codebase; fallback to legacy var
const LLM_COSTS_COLLECTION =
  (process.env.LLMCOSTS_COLLECTION_NAME || process.env.LLM_COSTS_COLLECTION || '').trim() || 'llm_costs';

/**
 * Normalize potential field variants present in llm_costs collection.
 * We derive:
 * - user_id: user_id | userId | user | user_uuid | user_uuid_str
 * - project_id: project_id | projectId | project | project_code
 * - agent_name: agent_name | agent | metadata.agent_name | service_type
 * - date: date | createdAt | timestamp
 * - input_tokens: input_tokens | usage.input_tokens | tokens_in | tokens_input
 * - output_tokens: output_tokens | usage.output_tokens | tokens_out | tokens_output
 * - cost: cost | total_cost | usage.cost
 */
function projectionStage() {
  return {
    $project: {
      user_id: {
        $toString: {
          $ifNull: [
            '$user_id',
            {
              $ifNull: [
                '$userId',
                { $ifNull: ['$user', { $ifNull: ['$user_uuid', '$user_uuid_str'] }] },
              ],
            },
          ],
        },
      },
      project_id: {
        // Normalize to string to avoid mixed-type grouping issues (ObjectId/number/string)
        $toString: {
          $ifNull: [
            '$project_id',
            { $ifNull: ['$projectId', { $ifNull: ['$project', '$project_code'] }] },
          ],
        },
      },
      agent_name: {
        $ifNull: [
          '$agent_name',
          {
            $ifNull: [
              '$agent',
              { $ifNull: ['$metadata.agent_name', { $ifNull: ['$service_type', '$operation'] }] },
            ],
          },
        ],
      },
      input_tokens: {
        $ifNull: [
          '$input_tokens',
          {
            $ifNull: [
              '$usage.input_tokens',
              { $ifNull: ['$tokens_in', { $ifNull: ['$tokens_input', 0] }] },
            ],
          },
        ],
      },
      output_tokens: {
        $ifNull: [
          '$output_tokens',
          {
            $ifNull: [
              '$usage.output_tokens',
              { $ifNull: ['$tokens_out', { $ifNull: ['$tokens_output', 0] }] },
            ],
          },
        ],
      },
      numeric_cost: {
        // Robust numeric conversion:
        // 1. Prefer 'cost' then 'total_cost' then 'usage.cost'
        // 2. If value is a string and starts with '$', strip it
        // 3. Convert to double with onError/onNull = 0
        $let: {
          vars: {
            rawCost: {
              $ifNull: ['$cost', { $ifNull: ['$total_cost', { $ifNull: ['$usage.cost', 0] }] }],
            },
          },
          in: {
            $convert: {
              input: {
                $cond: [
                  { $isNumber: '$$rawCost' },
                  '$$rawCost',
                  {
                    $cond: [
                      // If string and starts with '$', remove leading '$'
                      {
                        $and: [
                          { $eq: [{ $type: '$$rawCost' }, 'string'] },
                          { $eq: [{ $substrCP: ['$$rawCost', 0, 1] }, '$'] },
                        ],
                      },
                      { $substrCP: ['$$rawCost', 1, { $strLenCP: '$$rawCost' }] },
                      { $toString: '$$rawCost' },
                    ],
                  },
                ],
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
        },
      },
      dateRaw: {
        $ifNull: [
          '$date',
          {
            $ifNull: [
              '$createdAt',
              {
                $ifNull: [
                  '$timestamp',
                  { $ifNull: ['$created_at', { $ifNull: ['$updated_at', null] }] },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

function addDateKeyStage() {
  return {
    $addFields: {
      dateObj: {
        $cond: [
          { $eq: [{ $type: '$dateRaw' }, 'string'] },
          { $toDate: '$dateRaw' },
          '$dateRaw',
        ],
      },
    },
  };
}

function projectDateKeyStage() {
  return {
    $project: {
      user_id: 1,
      project_id: 1,
      agent_name: 1,
      input_tokens: { $ifNull: ['$input_tokens', 0] },
      output_tokens: { $ifNull: ['$output_tokens', 0] },
      numeric_cost: { $ifNull: ['$numeric_cost', 0] },
      dateKey: {
        $dateToString: {
          format: '%Y-%m-%d',
          date: { $ifNull: ['$dateObj', new Date(0)] },
        },
      },
    },
  };
}

function groupByAgentDateStage() {
  return {
    $group: {
      _id: {
        user_id: '$user_id',
        project_id: '$project_id',
        agent_name: '$agent_name',
        dateKey: '$dateKey',
      },
      day_cost: { $sum: '$numeric_cost' },
      day_input_tokens: { $sum: '$input_tokens' },
      day_output_tokens: { $sum: '$output_tokens' },
    },
  };
}

function groupAgentTotalsStage() {
  return {
    $group: {
      _id: {
        user_id: '$_id.user_id',
        project_id: '$_id.project_id',
        agent_name: '$_id.agent_name',
      },
      total_cost: { $sum: '$day_cost' },
      // Build costs_by_date as object: { dateKey: cost }
      costs_by_date_arr: {
        $push: {
          k: '$_id.dateKey',
          v: { $round: ['$day_cost', 6] },
        },
      },
      // Build tokens_by_date as object: { dateKey: { input_tokens, output_tokens } }
      tokens_by_date_arr: {
        $push: {
          k: '$_id.dateKey',
          v: {
            input_tokens: '$day_input_tokens',
            output_tokens: '$day_output_tokens',
          },
        },
      },
    },
  };
}

function agentProjectStage() {
  return {
    $project: {
      _id: 0,
      user_id: '$_id.user_id',
      project_id: '$_id.project_id',
      agent_name: '$_id.agent_name',
      total_cost: { $round: ['$total_cost', 6] },
      costs_by_date: { $arrayToObject: '$costs_by_date_arr' },
      tokens_by_date: { $arrayToObject: '$tokens_by_date_arr' },
    },
  };
}

function groupProjectStage() {
  return {
    $group: {
      _id: {
        user_id: '$user_id',
        project_id: '$project_id',
      },
      project_cost: { $sum: '$total_cost' },
      agents: {
        $push: {
          agent_name: '$agent_name',
          total_cost: '$total_cost',
          costs_by_date: '$costs_by_date',
          tokens_by_date: '$tokens_by_date',
        },
      },
    },
  };
}

function projectProjectStage() {
  return {
    $project: {
      _id: 0,
      user_id: '$_id.user_id',
      project_id: '$_id.project_id',
      project_cost: { $round: ['$project_cost', 6] },
      agents: 1,
    },
  };
}

function groupUserStage() {
  return {
    $group: {
      _id: '$user_id',
      user_cost: { $sum: '$project_cost' },
      projects: {
        $push: {
          project_id: '$project_id',
          project_cost: '$project_cost',
          agents: '$agents',
        },
      },
    },
  };
}

function finalProjectStage() {
  return {
    $project: {
      _id: 0,
      user_id: '$_id',
      type: { $literal: 'llm_interaction' },
      user_cost: { $round: ['$user_cost', 6] },
      projects: 1,
    },
  };
}

// PUBLIC_INTERFACE
async function aggregateHierarchy({ filter = {}, tenantId } = {}) {
  /**
   * Aggregates hierarchical cost data from the llm_costs collection.
   * PUBLIC_INTERFACE
   * @returns {Promise<Array>} Array of user-level aggregates:
   * [
   *   {
   *     user_id: 'uuid',
   *     type: 'llm_interaction',
   *     user_cost: '$0.123456',
   *     projects: [
   *       {
   *         project_id: 'p1',
   *         project_cost: '$0.123456',
   *         agents: [
   *           {
   *             agent_name: 'agent',
   *             total_cost: '$0.123456',
   *             costs_by_date: { 'YYYY-MM-DD': '$0.123456' },
   *             tokens_by_date: { 'YYYY-MM-DD': { input_tokens: 1, output_tokens: 2 } }
   *           }
   *         ]
   *       }
   *     ]
   *   }
   * ]
   */
  const db = await getDb();
  const col = db.collection(LLM_COSTS_COLLECTION);

  // Diagnostics for effective collection and $match
  try {
    // eslint-disable-next-line no-console
    console.log('[llm-costs.hierarchy] Using collection:', LLM_COSTS_COLLECTION);
  } catch {}
  
  // Build enforced filter with tenant
  const enforcedFilter = (() => {
    const f = filter && typeof filter === 'object' ? { ...filter } : {};
    delete f.tenant_id;
    delete f.tenantId;
    delete f.organization_id;
    delete f.organizationId;
    delete f.orgId;
    if (tenantId) {
      const tenantStr = String(tenantId);
      const orgFilter = {
        $or: [
          { tenant_id: tenantStr },
          { organization_id: tenantStr },
          { organizationId: tenantStr },
          { tenantId: tenantStr },
          { orgId: tenantStr },
          { 'tenant.tenant_id': tenantStr },
          // Case-insensitive fallbacks in case data casing differs
          { organization_id: { $regex: `^${tenantStr}$`, $options: 'i' } },
          { tenant_id: { $regex: `^${tenantStr}$`, $options: 'i' } },
        ],
      };
      return Object.keys(f).length ? { $and: [f, orgFilter] } : orgFilter;
    }
    return f;
  })();

  const pipeline = [
    { $match: enforcedFilter || {} },
    projectionStage(),
    addDateKeyStage(),
    projectDateKeyStage(),
    groupByAgentDateStage(),
    groupAgentTotalsStage(),
    agentProjectStage(),
    groupProjectStage(),
    projectProjectStage(),
    groupUserStage(),
    finalProjectStage(),
  ];

  // Enable disk use for large aggregations that may sort/group sizeable datasets to avoid 32MB memory limit
  // Temporary diagnostics to aid investigation of empty responses
  try {
    // eslint-disable-next-line no-console
    console.log('[llm-costs.hierarchy] Using collection:', LLM_COSTS_COLLECTION);
    // eslint-disable-next-line no-console
    console.log('[llm-costs.hierarchy] Effective $match:', JSON.stringify(pipeline[0]?.$match || {}));
  } catch {}

  const results = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();

  // Format currency with leading $ and two decimals
  const formatMoney = (n) => {
    const num = Number.isFinite(n) ? n : Number(n) || 0;
    return `$${num.toFixed(2)}`;
  };

  const formatted = results.map((user) => {
    const userCostNum = Number(user.user_cost || 0);
    return ({
      user_id: user.user_id,
      type: 'llm_interaction',
      user_cost: formatMoney(userCostNum),
      user_credits: usdToCredits(userCostNum),
      projects: (user.projects || []).map((p) => {
        const projectCostNum = Number(p.project_cost || 0);
        return ({
          project_id: p.project_id,
          project_cost: formatMoney(projectCostNum),
          project_credits: usdToCredits(projectCostNum),
          agents: (p.agents || []).map((a) => {
            // Convert costs_by_date numeric to $ string while keeping tokens object intact
            const cbd = a.costs_by_date || {};
            const formattedCostsByDate = Object.fromEntries(
              Object.entries(cbd).map(([k, v]) => [k, formatMoney(typeof v === 'number' ? v : 0)])
            );
            const creditsByDate = Object.fromEntries(
              Object.entries(cbd).map(([k, v]) => [k, usdToCredits(Number(v || 0))])
            );
            const agentCostNum = Number(a.total_cost || 0);
            return {
              agent_name: a.agent_name,
              total_cost: formatMoney(agentCostNum),
              total_credits: usdToCredits(agentCostNum),
              costs_by_date: formattedCostsByDate,
              costs_by_date_credits: creditsByDate,
              tokens_by_date: a.tokens_by_date || {},
            };
          }),
        });
      }),
    });
  });

  return formatted;
}

// PUBLIC_INTERFACE
async function ensureLlmCostsIndexes() {
  /** PUBLIC_INTERFACE
   * Ensures helpful indexes for the aggregation performance.
   */
  const db = await getDb();
  const col = db.collection('llm_costs'); // enforce underscore
  try {
    // eslint-disable-next-line no-console
    console.log('[llm-costs.hierarchy] ensure indexes on collection: llm_costs');
  } catch {}
  try { await col.createIndex({ tenant_id: 1, user_id: 1 }); } catch (e) {}
  try { await col.createIndex({ tenant_id: 1, project_id: 1 }); } catch (e) {}
  try { await col.createIndex({ tenant_id: 1, agent_name: 1 }); } catch (e) {}
  try { await col.createIndex({ tenant_id: 1, date: 1 }); } catch (e) {}
  try { await col.createIndex({ user_id: 1 }); } catch (e) {}
  try { await col.createIndex({ userId: 1 }); } catch (e) {}
  try { await col.createIndex({ project_id: 1 }); } catch (e) {}
  try { await col.createIndex({ projectId: 1 }); } catch (e) {}
  try { await col.createIndex({ agent_name: 1 }); } catch (e) {}
  try { await col.createIndex({ agent: 1 }); } catch (e) {}
  try { await col.createIndex({ date: 1 }); } catch (e) {}
  try { await col.createIndex({ createdAt: 1 }); } catch (e) {}
}

module.exports = {
  aggregateHierarchy,
  ensureLlmCostsIndexes,
};
