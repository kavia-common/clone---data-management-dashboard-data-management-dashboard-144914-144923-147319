'use strict';

/**
 * Analytics Usage Service
 * Provides aggregation utilities for:
 *  - Group by Agents
 *  - Group by Teams
 *  - Usage by User
 *  - Features by Credit (most/least used)
 *
 * Uses collections: session_tracking, llm_costs, users
 */

const SessionTracking = require('../models/sessionTracking.model');
const LLMCost = require('../models/llmCosts.model');
const User = require('../models/user.model');
const { toISODate, ensureDateRange } = require('../utils/date');
const { parseCurrencyToNumber } = require('../utils/currency');
const creditsUtil = require('../utils/credits');

/**
 * Build common date match for session_tracking based on last_updated or session_start
 */
function buildSessionDateMatch(from, to) {
  return {
    $or: [
      { last_updated: { $gte: from, $lte: to } },
      { session_start: { $gte: from, $lte: to } }
    ]
  };
}

/**
 * Build common date match for llm_costs based on timestamp/date/createdAt
 */
function buildCostDateMatch(from, to) {
  return {
    $or: [
      { timestamp: { $gte: from, $lte: to } },
      { date: { $gte: from, $lte: to } },
      { createdAt: { $gte: from, $lte: to } }
    ]
  };
}

/**
 * Normalize money-like value to number
 */
function normalizeCost(value) {
  if (typeof value === 'number') return value;
  if (value == null) return 0;
  return parseCurrencyToNumber(String(value));
}

/**
 * PUBLIC_INTERFACE
 * Group totals by agent name, using session_tracking and/or llm_costs.
 * Determines agent name from:
 *  - session_tracking.agents[].name
 *  - session_tracking.session_data.agent_name
 *  - session_tracking.service_type
 * For costs, tries: record.agent_name || record.service_type || 'Unknown'
 */
async function groupByAgents(opts = {}) {
  /** This is a public function. */
  const {
    from,
    to,
    tenant_id,
    project_id,
    user_id,
    status,
    limit
  } = opts;

  const { fromDate, toDate } = ensureDateRange(from, to, 30);

  // Session based aggregation: count sessions and sum tokens/calls if available
  const sessionMatch = {
    ...buildSessionDateMatch(fromDate, toDate)
  };
  if (tenant_id) sessionMatch.tenant_id = tenant_id;
  if (project_id) sessionMatch.project_id = project_id;
  if (user_id) sessionMatch.user_id = user_id;
  if (status) {
    // allow pipe separated list
    const statuses = status.split('|').map(s => s.trim()).filter(Boolean);
    if (statuses.length > 0) sessionMatch.status = { $in: statuses };
  }

  const sessionPipeline = [
    { $match: sessionMatch },
    {
      $addFields: {
        _agentCandidates: {
          $setUnion: [
            {
              $map: {
                input: { $ifNull: ['$agents', []] },
                as: 'a',
                in: '$$a.name'
              }
            },
            []
          ]
        }
      }
    },
    {
      $addFields: {
        _agent_name: {
          $ifNull: [
            { $arrayElemAt: ['$_agentCandidates', 0] },
            {
              $ifNull: ['$session_data.agent_name', {
                $ifNull: ['$service_type', 'Unknown']
              }]
            }
          ]
        }
      }
    },
    {
      $group: {
        _id: '$_agent_name',
        sessions: { $sum: 1 },
        total_calls: { $sum: { $ifNull: ['$total_calls', 0] } },
        total_tokens: { $sum: { $ifNull: ['$total_tokens', 0] } }
      }
    },
    {
      $project: {
        _id: 0,
        agent: '$_id',
        sessions: 1,
        total_calls: 1,
        total_tokens: 1
      }
    }
  ];

  // Cost aggregation: sum total_cost per agent_name hints
  const costMatch = {
    ...buildCostDateMatch(fromDate, toDate)
  };
  if (tenant_id) costMatch.tenant_id = tenant_id;
  if (project_id) costMatch.project_id = project_id;
  if (user_id) costMatch.user_id = user_id;

  const costPipeline = [
    { $match: costMatch },
    {
      $addFields: {
        _agent_name: {
          $ifNull: ['$agent_name', { $ifNull: ['$service_type', 'Unknown'] }]
        },
        _numeric_cost: {
          $cond: [
            { $isNumber: '$total_cost' },
            '$total_cost',
            0
          ]
        }
      }
    },
    {
      $group: {
        _id: '$_agent_name',
        total_cost: { $sum: '$_numeric_cost' }
      }
    },
    { $project: { _id: 0, agent: '$_id', total_cost: 1 } }
  ];

  const [sessionAgg, costAgg] = await Promise.all([
    SessionTracking.aggregate(sessionPipeline).allowDiskUse(true),
    LLMCost.aggregate(costPipeline).allowDiskUse(true)
  ]);

  // Merge by agent
  const byAgentMap = new Map();
  for (const row of sessionAgg) {
    const key = row.agent || 'Unknown';
    byAgentMap.set(key, { agent: key, sessions: row.sessions, total_calls: row.total_calls, total_tokens: row.total_tokens, total_cost: 0 });
  }
  for (const row of costAgg) {
    const key = row.agent || 'Unknown';
    const existing = byAgentMap.get(key) || { agent: key, sessions: 0, total_calls: 0, total_tokens: 0, total_cost: 0 };
    existing.total_cost = normalizeCost(existing.total_cost) + normalizeCost(row.total_cost);
    byAgentMap.set(key, existing);
  }

  let items = Array.from(byAgentMap.values())
    .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));

  const lim = parseInt(limit, 10);
  if (!Number.isNaN(lim) && lim > 0) items = items.slice(0, lim);

  return {
    items,
    meta: {
      from: toISODate(fromDate),
      to: toISODate(toDate),
      count: items.length
    }
  };
}

/**
 * PUBLIC_INTERFACE
 * Group aggregation by team_id using session_tracking and llm_costs.
 */
async function groupByTeams(opts = {}) {
  /** This is a public function. */
  const { from, to, tenant_id, project_id, status, limit } = opts;
  const { fromDate, toDate } = ensureDateRange(from, to, 30);

  const sessionMatch = {
    ...buildSessionDateMatch(fromDate, toDate)
  };
  if (tenant_id) sessionMatch.tenant_id = tenant_id;
  if (project_id) sessionMatch.project_id = project_id;
  if (status) {
    const statuses = status.split('|').map(s => s.trim()).filter(Boolean);
    if (statuses.length > 0) sessionMatch.status = { $in: statuses };
  }

  const sessionPipeline = [
    { $match: sessionMatch },
    {
      $group: {
        _id: { $ifNull: ['$team_id', 'Unassigned'] },
        sessions: { $sum: 1 },
        total_calls: { $sum: { $ifNull: ['$total_calls', 0] } },
        total_tokens: { $sum: { $ifNull: ['$total_tokens', 0] } }
      }
    },
    { $project: { _id: 0, team_id: '$_id', sessions: 1, total_calls: 1, total_tokens: 1 } }
  ];

  const costMatch = {
    ...buildCostDateMatch(fromDate, toDate)
  };
  if (tenant_id) costMatch.tenant_id = tenant_id;
  if (project_id) costMatch.project_id = project_id;

  const costPipeline = [
    { $match: costMatch },
    {
      $group: {
        _id: { $ifNull: ['$team_id', 'Unassigned'] },
        total_cost: { $sum: { $cond: [{ $isNumber: '$total_cost' }, '$total_cost', 0] } }
      }
    },
    { $project: { _id: 0, team_id: '$_id', total_cost: 1 } }
  ];

  const [sessionAgg, costAgg] = await Promise.all([
    SessionTracking.aggregate(sessionPipeline).allowDiskUse(true),
    LLMCost.aggregate(costPipeline).allowDiskUse(true)
  ]);

  const map = new Map();
  for (const row of sessionAgg) {
    map.set(row.team_id, { ...row, total_cost: 0 });
  }
  for (const row of costAgg) {
    const existing = map.get(row.team_id) || { team_id: row.team_id, sessions: 0, total_calls: 0, total_tokens: 0, total_cost: 0 };
    existing.total_cost = normalizeCost(existing.total_cost) + normalizeCost(row.total_cost);
    map.set(row.team_id, existing);
  }

  let items = Array.from(map.values()).sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));
  const lim = parseInt(limit, 10);
  if (!Number.isNaN(lim) && lim > 0) items = items.slice(0, lim);

  return {
    items,
    meta: {
      from: toISODate(fromDate),
      to: toISODate(toDate),
      count: items.length
    }
  };
}

/**
 * PUBLIC_INTERFACE
 * Usage by user: combines session and cost and joins basic display info
 */
async function usageByUser(opts = {}) {
  /** This is a public function. */
  const { from, to, tenant_id, project_id, user_id, status, limit } = opts;
  const { fromDate, toDate } = ensureDateRange(from, to, 30);

  const sessionMatch = {
    ...buildSessionDateMatch(fromDate, toDate)
  };
  if (tenant_id) sessionMatch.tenant_id = tenant_id;
  if (project_id) sessionMatch.project_id = project_id;
  if (user_id) sessionMatch.user_id = user_id;
  if (status) {
    const statuses = status.split('|').map(s => s.trim()).filter(Boolean);
    if (statuses.length > 0) sessionMatch.status = { $in: statuses };
  }

  const sessionPipeline = [
    { $match: sessionMatch },
    {
      $group: {
        _id: { $ifNull: ['$user_id', 'unknown'] },
        sessions: { $sum: 1 },
        total_calls: { $sum: { $ifNull: ['$total_calls', 0] } },
        total_tokens: { $sum: { $ifNull: ['$total_tokens', 0] } },
        last_activity: { $max: { $ifNull: ['$last_updated', '$session_start'] } }
      }
    },
    { $project: { _id: 0, user_id: '$_id', sessions: 1, total_calls: 1, total_tokens: 1, last_activity: 1 } }
  ];

  const costMatch = {
    ...buildCostDateMatch(fromDate, toDate)
  };
  if (tenant_id) costMatch.tenant_id = tenant_id;
  if (project_id) costMatch.project_id = project_id;
  if (user_id) costMatch.user_id = user_id;

  const costPipeline = [
    { $match: costMatch },
    {
      $group: {
        _id: { $ifNull: ['$user_id', 'unknown'] },
        total_cost: { $sum: { $cond: [{ $isNumber: '$total_cost' }, '$total_cost', 0] } }
      }
    },
    { $project: { _id: 0, user_id: '$_id', total_cost: 1 } }
  ];

  const [sessionAgg, costAgg] = await Promise.all([
    SessionTracking.aggregate(sessionPipeline).allowDiskUse(true),
    LLMCost.aggregate(costPipeline).allowDiskUse(true)
  ]);

  const byUser = new Map();
  for (const row of sessionAgg) {
    byUser.set(String(row.user_id), { ...row, total_cost: 0 });
  }
  for (const row of costAgg) {
    const key = String(row.user_id);
    const existing = byUser.get(key) || { user_id: key, sessions: 0, total_calls: 0, total_tokens: 0, last_activity: null, total_cost: 0 };
    existing.total_cost = normalizeCost(existing.total_cost) + normalizeCost(row.total_cost);
    byUser.set(key, existing);
  }

  // join user display info
  const ids = Array.from(byUser.keys()).filter(id => id && id !== 'unknown');
  let users = [];
  if (ids.length) {
    users = await User.find({ _id: { $in: ids } }, { name: 1, email: 1, display_name: 1, profile: 1 }).lean();
  }
  const userMap = new Map(users.map(u => [String(u._id), u]));

  let items = Array.from(byUser.values()).map(row => {
    const info = userMap.get(String(row.user_id)) || {};
    return {
      ...row,
      user: {
        _id: String(row.user_id),
        name: info.name || info.display_name || info.email || 'Unknown',
        email: info.email || null,
        display_name: info.display_name || null,
        profile: info.profile || null
      }
    };
  });

  items.sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));
  const lim = parseInt(limit, 10);
  if (!Number.isNaN(lim) && lim > 0) items = items.slice(0, lim);

  return {
    items,
    meta: {
      from: toISODate(fromDate),
      to: toISODate(toDate),
      count: items.length
    }
  };
}

/**
 * PUBLIC_INTERFACE
 * Features by credit consumption (most/least used).
 * Feature derived from: service_type || operation || type || 'Unknown'
 * Uses creditsUtil if available; falls back to total_cost number.
 */
async function featuresByCredit(opts = {}) {
  /** This is a public function. */
  const { from, to, tenant_id, project_id, top = 5, bottom = 5 } = opts;
  const { fromDate, toDate } = ensureDateRange(from, to, 30);

  const match = {
    ...buildCostDateMatch(fromDate, toDate)
  };
  if (tenant_id) match.tenant_id = tenant_id;
  if (project_id) match.project_id = project_id;

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        _feature: {
          $ifNull: [
            '$service_type',
            { $ifNull: ['$operation', { $ifNull: ['$type', 'Unknown'] }] }
          ]
        },
        _costNum: {
          $cond: [{ $isNumber: '$total_cost' }, '$total_cost', 0]
        }
      }
    },
    {
      $group: {
        _id: '$_feature',
        total_cost: { $sum: '$_costNum' },
        count: { $sum: 1 }
      }
    },
    { $project: { _id: 0, feature: '$_id', total_cost: 1, count: 1 } }
  ];

  const rows = await LLMCost.aggregate(pipeline).allowDiskUse(true);

  // Convert cost to credits if util supports it
  const items = rows.map(r => {
    let credits = 0;
    try {
      if (typeof creditsUtil.toCreditsFromUSD === 'function') {
        credits = creditsUtil.toCreditsFromUSD(normalizeCost(r.total_cost));
      } else if (typeof creditsUtil.toCredits === 'function') {
        credits = creditsUtil.toCredits(normalizeCost(r.total_cost));
      } else {
        credits = normalizeCost(r.total_cost);
      }
    } catch (e) {
      credits = normalizeCost(r.total_cost);
    }
    return { feature: r.feature || 'Unknown', total_cost: normalizeCost(r.total_cost), credits, count: r.count };
  });

  // Sort by credits
  const sorted = items.sort((a, b) => (b.credits || 0) - (a.credits || 0));
  const topN = Math.max(parseInt(top, 10) || 0, 0);
  const bottomN = Math.max(parseInt(bottom, 10) || 0, 0);
  const result = {
    top: topN > 0 ? sorted.slice(0, topN) : sorted.slice(0, 5),
    bottom: bottomN > 0 ? sorted.slice(-bottomN) : sorted.slice(-5)
  };

  return {
    items: result,
    meta: {
      from: toISODate(fromDate),
      to: toISODate(toDate),
      totalFeatures: items.length
    }
  };
}

module.exports = {
  groupByAgents,
  groupByTeams,
  usageByUser,
  featuresByCredit
};
