'use strict';

/**
 * PUBLIC_INTERFACE
 * aggregateAgentsUsageAndCost
 * Aggregates agent costs and usage across session_tracking and llm-costs collections.
 * - Parses currency-like strings (e.g., "$0.108255") safely to numbers.
 * - Sums costs and tokens (usage) per agent, merging both sources.
 * - Supports optional filters: tenant_id, project_id, from, to.
 * - Returns a stable envelope { items, total, meta } where items include:
 *     { agent_name, total_cost: number, total_usage: number, session_count: number, source_breakdown }
 */

/**
 * Safe number parser that handles strings like "$0.108255", " 1,234.56 " etc.
 */
function toNumberSafe(value) {
  if (typeof value === 'number') {return value;}
  if (value === null || value === undefined) {return 0;}
  const s = String(value).trim().replace(/\$/g, '').replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// PUBLIC_INTERFACE
async function aggregateAgentsUsageAndCost(
  db,
  {
    tenant_id,
    project_id,
    from,
    to,
    limit = 50,
    offset = 0,
  } = {}
) {
  const sessionTrackingCol = db.collection('session_tracking');
  const llmCostsCol = db.collection('llm_costs');

  // --- Build match filters ---
  const andConditions = [];

  if (tenant_id) {
    andConditions.push({
      $or: [
        { tenant_id },
        { organization_id: tenant_id },
        { org_id: tenant_id },
        { tenantId: tenant_id },
      ],
    });
  }

  if (project_id) {
    andConditions.push({
      $or: [
        { project_id },
        { projectId: project_id },
        { 'project.id': project_id },
        { 'metadata.projectId': project_id },
      ],
    });
  }

  if (from || to) {
    const range = {};
    if (from) {range.$gte = new Date(from);}
    if (to) {range.$lte = new Date(to);}
    andConditions.push({
      $or: [
        { last_updated: range },
        { updatedAt: range },
        { createdAt: range },
        { session_start: range },
        { timestamp: range },
        { date: range },
      ],
    });
  }

  const sessionMatch = andConditions.length ? { $and: andConditions } : {};

  // 1) Aggregate session_tracking: agent_costs and optional token usage if available
  const sessionTrackingPipeline = [
    { $match: sessionMatch },
    {
      $addFields: {
        // Support multiple structures:
        // - agents: [{ agent_name, total_cost, total_tokens }]
        // - agent_costs: { "<agent>": "$0.23", ... } or numeric
        agent_costs_array: {
          $cond: [
            { $isArray: '$agents' },
            '$agents',
            {
              $cond: [
                { $gt: [{ $type: '$agent_costs' }, 'missing'] },
                { $objectToArray: '$agent_costs' },
                [],
              ],
            },
          ],
        },
      },
    },
    { $unwind: { path: '$agent_costs_array', preserveNullAndEmptyArrays: false } },
    {
      $project: {
        session_identifier: { $ifNull: ['$session_id', { $ifNull: ['$_id', '$task_id'] }] },
        agent_name: {
          $ifNull: [
            '$agent_costs_array.k',
            { $ifNull: ['$agent_costs_array.name', '$agent_costs_array.agent_name'] },
          ],
        },
        raw_cost: {
          $ifNull: [
            '$agent_costs_array.v',
            { $ifNull: ['$agent_costs_array.cost', '$agent_costs_array.total_cost'] },
          ],
        },
        // collect any usage counters/tokens from session where available
        usage_tokens: {
          $ifNull: [
            '$usage_tokens',
            {
              $ifNull: [
                '$tokens',
                {
                  $ifNull: ['$usage.total_tokens', { $ifNull: ['$agent_costs_array.total_tokens', 0] }],
                },
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        cost: {
          $cond: [
            { $isNumber: '$raw_cost' },
            '$raw_cost',
            {
              $toDouble: {
                $replaceAll: { input: { $toString: '$raw_cost' }, find: '$', replacement: '' },
              },
            },
          ],
        },
        tokens: {
          $cond: [{ $isNumber: '$usage_tokens' }, '$usage_tokens', 0],
        },
      },
    },
    { $match: { agent_name: { $ne: null } } },
    {
      $group: {
        _id: '$agent_name',
        cost: { $sum: { $ifNull: ['$cost', 0] } },
        total_tokens: { $sum: { $ifNull: ['$tokens', 0] } },
        sessions: { $addToSet: '$session_identifier' },
      },
    },
    {
      $project: {
        _id: 0,
        agent_name: '$_id',
        cost: 1,
        total_tokens: 1,
        session_count: { $size: '$sessions' },
      },
    },
  ];

  // 2) Aggregate llm-costs.agents with strict normalization of currency strings and tokens
  const llmCostsPipeline = [
    { $match: sessionMatch },
    { $unwind: { path: '$agents', preserveNullAndEmptyArrays: false } },
    {
      $project: {
        agent_name: { $ifNull: ['$agents.agent_name', '$agents.name'] },
        raw_cost: { $ifNull: ['$agents.total_cost', '$agents.cost'] },
        raw_usage: { $ifNull: ['$agents.total_tokens', '$agents.tokens'] },
      },
    },
    {
      $addFields: {
        cost: {
          $cond: [
            { $isNumber: '$raw_cost' },
            '$raw_cost',
            {
              $toDouble: {
                $replaceAll: { input: { $toString: '$raw_cost' }, find: '$', replacement: '' },
              },
            },
          ],
        },
        tokens: {
          $cond: [{ $isNumber: '$raw_usage' }, '$raw_usage', 0],
        },
      },
    },
    { $match: { agent_name: { $ne: null } } },
    {
      $group: {
        _id: '$agent_name',
        cost: { $sum: { $ifNull: ['$cost', 0] } },
        total_tokens: { $sum: { $ifNull: ['$tokens', 0] } },
      },
    },
    { $project: { _id: 0, agent_name: '$_id', cost: 1, total_tokens: 1 } },
  ];

  let sessionAgg = [];
  let llmAgg = [];
  try {
    [sessionAgg, llmAgg] = await Promise.all([
      sessionTrackingCol.aggregate(sessionTrackingPipeline, { allowDiskUse: true }).toArray(),
      llmCostsCol.aggregate(llmCostsPipeline, { allowDiskUse: true }).toArray(),
    ]);
  } catch (err) {
    // Fail closed to empty results to avoid frontend "Network error"
     
    console.error('[aggregateAgentsUsageAndCost] aggregation error:', err?.message || err);
    sessionAgg = [];
    llmAgg = [];
  }

  // Merge results
  const map = new Map();

  for (const s of sessionAgg) {
    map.set(s.agent_name, {
      agent_name: s.agent_name,
      source_breakdown: {
        session_tracking: { cost: s.cost || 0, tokens: s.total_tokens || 0 },
        llm_costs: { cost: 0, tokens: 0 },
      },
      session_count: s.session_count || 0,
    });
  }

  for (const l of llmAgg) {
    if (!map.has(l.agent_name)) {
      map.set(l.agent_name, {
        agent_name: l.agent_name,
        source_breakdown: {
          session_tracking: { cost: 0, tokens: 0 },
          llm_costs: { cost: l.cost || 0, tokens: l.total_tokens || 0 },
        },
        session_count: 0,
      });
    } else {
      const existing = map.get(l.agent_name);
      existing.source_breakdown.llm_costs.cost += l.cost || 0;
      existing.source_breakdown.llm_costs.tokens += l.total_tokens || 0;
    }
  }

  const items = Array.from(map.values()).map((x) => {
    const st = x.source_breakdown.session_tracking;
    const lc = x.source_breakdown.llm_costs;
    const total_cost = Number(((st.cost || 0) + (lc.cost || 0)).toFixed(6));
    const total_usage = Number(((st.tokens || 0) + (lc.tokens || 0)).toFixed(0));
    return {
      agent_name: x.agent_name,
      total_cost,
      total_usage,
      session_count: x.session_count,
      source_breakdown: x.source_breakdown,
    };
  });

  items.sort((a, b) => b.total_cost - a.total_cost);

  const total = items.length;
  const sliced = items.slice(offset, offset + limit);

  return {
    items: sliced,
    total,
    meta: {
      limit,
      offset,
      from: from || null,
      to: to || null,
      tenant_id: tenant_id || null,
      project_id: project_id || null,
    },
  };
}

module.exports = { aggregateAgentsUsageAndCost };
