'use strict';

// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-BE-LLM-COST-BY-AGENT
// User Story: As a consumer, I need an API to get LLM total cost aggregated by agent name.
// Acceptance Criteria:
// - GET /api/analytics/llm-cost-by-agent returns 200 with [{ agent: string, total_cost: number }] sorted desc.
// - Prefer detecting plausible collections (e.g., 'llm-costs', 'llm_costs', 'logs', 'events', 'interactions', 'agentLogs').
// - $match to include only docs having both agent name and cost.
// - $group by agent name, sum cost; $project and round to 6 decimals; $sort desc.
// - Empty array [] when no data.
// - Errors handled with 500 by controller; service should not throw unhandled exceptions.
// GxP Impact: NO (read-only analytics)
// Risk Level: LOW
// ============================================================================

const { getCollection } = require('../config/db');
const { parseCurrencyToNumber, roundTo } = require('../utils/currency');

/**
 * Build a Mongo pipeline for flat schema:
 * - Accepts docs with agent_name|agent|tool and total_cost|cost
 * - Ensures only docs with both an agent identifier and a cost are considered
 * - Groups and sums, projects rounded totals, sorts desc
 */
function buildFlatAgentCostPipeline() {
  return [
    {
      $match: {
        $and: [
          {
            $or: [
              { agent_name: { $exists: true } },
              { agent: { $exists: true } },
              { tool: { $exists: true } },
            ],
          },
          {
            $or: [{ total_cost: { $exists: true } }, { cost: { $exists: true } }],
          },
        ],
      },
    },
    {
      $addFields: {
        agent_norm: {
          $trim: {
            input: {
              $ifNull: ['$agent_name', { $ifNull: ['$agent', { $ifNull: ['$tool', ''] }] }],
            },
          },
        },
        // Prepare number by coercing potential strings, removing $ and commas
        _cost_str: {
          $toString: {
            $ifNull: ['$total_cost', { $ifNull: ['$cost', 0] }],
          },
        },
      },
    },
    {
      $addFields: {
        _cost_sanitized: {
          $replaceAll: {
            input: {
              $replaceAll: {
                input: '$_cost_str',
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
    {
      $addFields: {
        total_num: {
          $ifNull: [{ $toDouble: '$_cost_sanitized' }, 0],
        },
      },
    },
    {
      $set: {
        agent_norm: {
          $cond: [{ $eq: ['$agent_norm', ''] }, 'Unknown', '$agent_norm'],
        },
      },
    },
    {
      $group: {
        _id: '$agent_norm',
        total_cost: { $sum: '$total_num' },
      },
    },
    {
      $project: {
        _id: 0,
        agent: '$_id',
        total_cost: { $round: ['$total_cost', 6] },
      },
    },
    { $sort: { total_cost: -1 } },
  ];
}

/**
 * Build the MongoDB aggregation pipeline for array schema with Agents[] having
 * "Agent Name" and "Total Cost"
 */
function buildAgentsArrayPipeline() {
  return [
    // Ensure Agents is an array and has both fields in at least one element
    {
      $match: {
        Agents: { $exists: true, $type: 'array' },
        'Agents.Agent Name': { $exists: true },
        'Agents.Total Cost': { $exists: true },
      },
    },
    { $unwind: '$Agents' },
    {
      $set: {
        _agent_trimmed: {
          $trim: { input: { $toString: { $ifNull: ['$Agents.Agent Name', ''] } } },
        },
        _cost_string: {
          $replaceAll: {
            input: {
              $replaceAll: {
                input: { $toString: { $ifNull: ['$Agents.Total Cost', 0] } },
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
    {
      $set: {
        _agent: {
          $cond: [{ $eq: ['_agent_trimmed', ''] }, 'Unknown', '$_agent_trimmed'],
        },
        _cost: {
          $toDouble: { $ifNull: ['$_cost_string', '0'] },
        },
      },
    },
    {
      $group: {
        _id: '$_agent',
        total_cost: { $sum: '$_cost' },
      },
    },
    {
      $project: {
        _id: 0,
        agent: '$_id',
        total_cost: { $round: ['$total_cost', 6] },
      },
    },
    { $sort: { total_cost: -1 } },
  ];
}

/**
// PUBLIC_INTERFACE
 * aggregateAgentsInApp
 * Pure in-process fallback aggregator for environments lacking server operators.
 * Accepts an array of documents (or cursor materialized) with shape: { Agents: [{ "Agent Name": string, "Total Cost": string|number }, ...] }
 * Returns: [{ agent, total_cost }] sorted descending by total_cost with 6-decimal rounding.
 * @param {Array<object>} documents
 * @returns {Array<{agent: string, total_cost: number}>}
 */
function aggregateAgentsInApp(documents = []) {
  const totals = new Map();
  const docs = Array.isArray(documents) ? documents : [];
  for (const doc of docs) {
    const agents = Array.isArray(doc?.Agents) ? doc.Agents : [];
    for (const a of agents) {
      try {
        const nameRaw = a?.['Agent Name'];
        const agent = String(nameRaw == null ? '' : nameRaw).trim() || 'Unknown';
        const cost = parseCurrencyToNumber(a?.['Total Cost']);
        const prev = totals.get(agent) || 0;
        totals.set(agent, prev + (Number.isFinite(cost) ? cost : 0));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[llmCost.service] Skipped malformed agent entry:', e?.message || e);
      }
    }
  }
  const arr = Array.from(totals.entries()).map(([agent, total]) => ({
    agent,
    // Ensure 6-decimal precision using roundTo (equivalent to Number(parseFloat(n.toFixed(6))))
    total_cost: roundTo(total, 6),
  }));
  arr.sort((a, b) => b.total_cost - a.total_cost);
  return arr;
}

/**
// PUBLIC_INTERFACE
 * getLlmCostByAgent
 * Attempts to aggregate at the database level across plausible collections/schemas; if unsupported operators cause failure,
 * falls back to in-process aggregation for Agents[] schema. Returns [] when no data.
 * @returns {Promise<Array<{agent: string, total_cost: number}>>}
 */
async function getLlmCostByAgent() {
  // Prefer a broader set of collection candidates per requirement
  const collection = await getCollection([
    'llm-costs',
    'llm_costs',
    'llm_cost',
    'logs',
    'events',
    'interactions',
    'agentLogs',
  ]);

  try {
    // First, try a flat schema pipeline (agent_name/agent/tool + total_cost/cost)
    const flatPipeline = buildFlatAgentCostPipeline();
    const flatResults = await collection.aggregate(flatPipeline, { allowDiskUse: true }).toArray();

    if (Array.isArray(flatResults) && flatResults.length > 0) {
      const arr = flatResults.map((r) => ({
        agent: String(r?.agent ?? 'Unknown'),
        // Use numeric rounding with 6-decimal precision
        total_cost: roundTo(Number(r?.total_cost ?? 0), 6),
      }));
      // Defensive sort
      arr.sort((a, b) => b.total_cost - a.total_cost);
      return arr;
    }

    // Next, try Agents[] array schema pipeline
    const arrayPipeline = buildAgentsArrayPipeline();
    const arrayResults = await collection.aggregate(arrayPipeline, { allowDiskUse: true }).toArray();

    if (Array.isArray(arrayResults) && arrayResults.length > 0) {
      const arr = arrayResults.map((r) => ({
        agent: String(r?.agent ?? 'Unknown'),
        total_cost: roundTo(Number(r?.total_cost ?? 0), 6),
      }));
      arr.sort((a, b) => b.total_cost - a.total_cost);
      return arr;
    }

    // If no results from either pipeline, return empty array
    return [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[llmCost.service] Aggregation pipeline failed; attempting in-app fallback:', err?.message || err);
    try {
      // Fallback: fetch only Agents field to minimize payload when attempting in-app reduction
      const cursor = collection.find(
        { Agents: { $exists: true, $type: 'array' } },
        { projection: { Agents: 1 } }
      );
      const docs = await cursor.toArray();
      if (!docs || docs.length === 0) {
        return [];
      }
      return aggregateAgentsInApp(docs);
    } catch (e) {
      // Final safeguard: never throw to the caller; return empty list
      // eslint-disable-next-line no-console
      console.warn('[llmCost.service] In-app fallback failed:', e?.message || e);
      return [];
    }
  }
}

module.exports = {
  getLlmCostByAgent,
  aggregateAgentsInApp,
};
