'use strict';

// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-BE-LLM-COST-BY-AGENT
// User Story: As a consumer, I need an API to get LLM total cost aggregated by agent name.
// Acceptance Criteria:
// - GET /api/analytics/llm-cost-by-agent returns 200 with [{ agent: string, total_cost: number }] sorted desc.
// - Reads from collection where documents have Agents array with "Agent Name" and "Total Cost" (string with $).
// - Ignores malformed/missing values safely; logs errors without crashing.
// - Rounds totals to 6 decimals.
// - Unit tests cover parsing and aggregation.
// GxP Impact: NO (read-only analytics)
// Risk Level: LOW
// ============================================================================

const { getCollection } = require('../config/db');
const { parseCurrencyToNumber, roundTo } = require('../utils/currency');

/**
 * Build the MongoDB aggregation pipeline using native operators to:
 * - Unwind Agents
 * - Parse $-prefixed costs to numbers
 * - Group and sum by Agents.Agent Name
 * - Project sorted results with rounding to 6 decimals
 */
function buildPipeline() {
  return [
    // Ensure Agents is an array
    { $match: { Agents: { $exists: true, $type: 'array' } } },
    { $unwind: '$Agents' },

    // Normalize agent name and cost fields safely
    {
      $set: {
        _agent_trimmed: {
          $trim: {
            input: { $toString: { $ifNull: ['$Agents.Agent Name', ''] } },
          },
        },
        _cost_string: {
          // Stringify, then strip commas and '$' before converting to double
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
          $cond: [{ $eq: ['$_agent_trimmed', ''] }, 'Unknown', '$_agent_trimmed'],
        },
        _cost: {
          $toDouble: { $ifNull: ['$_cost_string', '0'] },
        },
      },
    },

    // Group and sum
    {
      $group: {
        _id: '$_agent',
        total_cost: { $sum: '$_cost' },
      },
    },

    // Project and round to 6 decimals
    {
      $project: {
        _id: 0,
        agent: '$_id',
        total_cost: { $round: ['$total_cost', 6] },
      },
    },

    // Sort descending
    { $sort: { total_cost: -1 } },
  ];
}

/**
// PUBLIC_INTERFACE
 * aggregateAgentsInApp
 * Pure in-process fallback aggregator for environments lacking $replaceAll/$toDouble.
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
    total_cost: roundTo(total, 6),
  }));
  arr.sort((a, b) => b.total_cost - a.total_cost);
  return arr;
}

/**
// PUBLIC_INTERFACE
 * getLlmCostByAgent
 * Attempts to aggregate at the database level; if unsupported operators cause failure,
 * falls back to in-process aggregation.
 * @returns {Promise<Array<{agent: string, total_cost: number}>>}
 */
async function getLlmCostByAgent() {
  // Prefer common names, including hyphenated and underscored variants
  const collection = await getCollection(['llm-costs', 'llm_cost', 'llm_costs']);
  try {
    const pipeline = buildPipeline();
    const results = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();
    // Defensive sort and rounding, though pipeline already enforces
    const arr = (Array.isArray(results) ? results : []).map((r) => ({
      agent: String(r?.agent ?? 'Unknown'),
      total_cost: roundTo(Number(r?.total_cost ?? 0), 6),
    }));
    arr.sort((a, b) => b.total_cost - a.total_cost);
    return arr;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[llmCost.service] Aggregation pipeline failed; falling back to in-app aggregation:', err?.message || err);
    // Fallback: fetch only Agents field to minimize payload
    const cursor = collection.find(
      { Agents: { $exists: true, $type: 'array' } },
      { projection: { Agents: 1 } }
    );
    const docs = await cursor.toArray();
    return aggregateAgentsInApp(docs);
  }
}

module.exports = {
  getLlmCostByAgent,
  aggregateAgentsInApp,
};
