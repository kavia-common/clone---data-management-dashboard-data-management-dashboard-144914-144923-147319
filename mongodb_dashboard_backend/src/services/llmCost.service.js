'use strict';

// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-BE-LLM-COST-BY-AGENT
// User Story: As a consumer, I need an API to get LLM total cost aggregated by agent name.
// Acceptance Criteria:
// - Service uses project DB connection (no duplicate connections).
// - Honors env LLM_EVENTS_COLLECTION for collection name (single or comma-separated).
// - Default collection name is 'llm_events' (with sensible fallbacks).
// - Supports multiple shapes for agent and cost (USD):
//     agent candidates: agentName, agent, agent_name, tool, metadata.agent, metadata.agentName, metadata["Agent Name"]
//     cost candidates: cost_usd, cost.amount where cost.currency==='USD', total_cost when currency==='USD' or currency missing, cost
// - Aggregation sums by normalized agent (case-insensitive), but preserves a display casing.
// - Sorted descending by total_cost and rounded to 6 decimals.
// - Returns [] when no data.
// - Adds safe fallbacks and logs when shapes are unknown.
// GxP Impact: NO (read-only analytics)
// Risk Level: LOW
// ============================================================================

const { getCollection } = require('../config/db');
const { parseCurrencyToNumber, roundTo } = require('../utils/currency');

/**
 * Utility: determine collection candidates from env and defaults.
 * - LLM_EVENTS_COLLECTION can be a single name or comma-separated names.
 * - Defaults prioritize 'llm_events' then common LLM cost/event collections.
 */
function resolveCollectionCandidates() {
  const envVal = (process.env.LLM_EVENTS_COLLECTION || '').trim();
  const envCandidates = envVal
    ? envVal
        .split(',')
        .map((s) => s.trim())
        .filter((s) => !!s)
    : [];

  // Deduplicate while preserving order
  // Default priority updated to prefer 'llm_cost' as the canonical collection name
  const defaults = [
    // 'llm_cost',   // preferred default
    // 'llm_costs',
    'llm-costs',
    'llm_events',
    'llm-events',
    'events',
    'logs',
    'interactions',
    'agentLogs',
  ];
  const seen = new Set();
  const all = [...envCandidates, ...defaults].filter((n) => {
    if (!n || seen.has(n)) {return false;}
    seen.add(n);
    return true;
  });
  return all;
}

/**
 * Build a Mongo pipeline for flat schema:
 * - Accepts docs with various agent fields and cost fields.
 * - Supports nested { cost: { amount, currency } } and sums only when currency == 'USD'.
 * - If top-level { currency: 'USD' } use total_cost; if currency missing, assume total_cost is USD and include.
 * - Groups by lowercase normalized agent, but preserves first-seen display casing.
 * - Projects rounded totals and sorts desc.
 */
function buildFlatAgentCostPipeline() {
  return [
    // Compute helper fields up-front so we can safely reference keys with spaces
    {
      $addFields: {
        // Access metadata['Agent Name'] safely (Mongo key with space) using $getField
        _agent_meta_agent_name: {
          $cond: [
            { $and: [{ $ne: ['$metadata', null] }, { $eq: [{ $type: '$metadata' }, 'object'] }] },
            { $getField: { field: 'Agent Name', input: '$metadata' } },
            null,
          ],
        },
        // Access top-level fields with spaces using $getField on $$ROOT
        _root_agent_name: { $getField: { field: 'Agent Name', input: '$$ROOT' } },
        _root_total_cost: { $getField: { field: 'Total Cost', input: '$$ROOT' } },
      },
    },
    // Derive normalized agent and a numeric cost candidate in USD
    {
      $addFields: {
        // Normalize agent: prefer explicit fields including metadata and top-level 'Agent Name'
        _agent_raw: {
          $ifNull: [
            '$agentName',
            {
              $ifNull: [
                '$agent',
                {
                  $ifNull: [
                    '$metadata.agent',
                    {
                      $ifNull: [
                        '$agent_name',
                        {
                          $ifNull: [
                            '$metadata.agentName',
                            {
                              $ifNull: ['$_agent_meta_agent_name', { $ifNull: ['$_root_agent_name', { $ifNull: ['$tool', ''] }] }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        // Structured cost if cost is an object with USD currency
        _cost_from_object: {
          $cond: [
            { $eq: [{ $type: '$cost' }, 'object'] },
            {
              $cond: [
                { $eq: [{ $toUpper: { $toString: { $ifNull: ['$cost.currency', ''] } } }, 'USD'] },
                { $ifNull: ['$cost.amount', 0] },
                null,
              ],
            },
            null,
          ],
        },
        // If top-level currency is USD, prefer total_cost
        _cost_from_top_total_if_usd: {
          $cond: [
            {
              $and: [
                { $ne: ['$currency', null] },
                { $eq: [{ $toUpper: { $toString: { $ifNull: ['$currency', ''] } } }, 'USD'] },
              ],
            },
            { $ifNull: ['$total_cost', null] },
            null,
          ],
        },
      },
    },
    {
      $addFields: {
        // Pick first available cost candidate in USD-context
        _cost_prefer: {
          $ifNull: [
            '$cost_usd',
            {
              $ifNull: [
                '$_cost_from_object',
                {
                  $ifNull: [
                    '$_cost_from_top_total_if_usd',
                    {
                      $ifNull: [
                        '$_root_total_cost', // support top-level 'Total Cost' (already aggregated)
                        {
                          $ifNull: [
                            '$total_cost',
                            // As a last fallback consider 'cost' (may be number or string)
                            '$cost',
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        // Prepare display value with original casing/spacing
        _agent_display: {
          $trim: {
            input: { $toString: { $ifNull: ['$_agent_raw', ''] } },
          },
        },
        // Sanitize cost to string for uniform parsing when value is not strictly numeric
        _cost_str: { $toString: { $ifNull: ['$_cost_prefer', 0] } },
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
      $set: {
        // Normalize agent to lowercase for grouping; empty -> 'unknown' key and 'Unknown' display
        agent_norm: {
          $let: {
            vars: { t: '$_agent_display' },
            in: {
              $cond: [{ $eq: ['$$t', ''] }, 'unknown', { $toLower: '$$t' }],
            },
          },
        },
        agent_display: {
          $let: {
            vars: { t: '$_agent_display' },
            in: { $cond: [{ $eq: ['$$t', ''] }, 'Unknown', '$$t'] },
          },
        },
        // Safe numeric conversion
        total_num: {
          $convert: { input: '$_cost_sanitized', to: 'double', onError: 0, onNull: 0 },
        },
      },
    },
    {
      $match: {
        $and: [{ agent_norm: { $ne: '' } }, { total_num: { $gt: 0 } }],
      },
    },
    {
      $group: {
        _id: '$agent_norm',
        total_cost: { $sum: '$total_num' },
        agent_display: { $first: '$agent_display' }, // preserve one display casing
      },
    },
    {
      $project: {
        _id: 0,
        agent: { $ifNull: ['$agent_display', '$_id'] },
        total_cost: { $round: ['$total_cost', 6] },
      },
    },
    { $sort: { total_cost: -1 } },
  ];
}

/**
 * Build the MongoDB aggregation pipeline for array schema with Agents[] having
 * "Agent Name" and "Total Cost".
 * - Normalizes agent to lowercase for case-insensitive grouping but keeps a display casing.
 */
function buildAgentsArrayPipeline() {
  return [
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
        _agent_display: {
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
        agent_norm: {
          $let: {
            vars: { t: '$_agent_display' },
            in: { $cond: [{ $eq: ['$$t', ''] }, 'unknown', { $toLower: '$$t' }] },
          },
        },
        agent_display: {
          $let: {
            vars: { t: '$_agent_display' },
            in: { $cond: [{ $eq: ['$$t', ''] }, 'Unknown', '$$t'] },
          },
        },
        cost_num: {
          $convert: { input: '$_cost_string', to: 'double', onError: 0, onNull: 0 },
        },
      },
    },
    {
      $match: {
        $and: [{ agent_norm: { $ne: '' } }, { cost_num: { $gt: 0 } }],
      },
    },
    {
      $group: {
        _id: '$agent_norm',
        total_cost: { $sum: '$cost_num' },
        agent_display: { $first: '$agent_display' },
      },
    },
    {
      $project: {
        _id: 0,
        agent: { $ifNull: ['$agent_display', '$_id'] },
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
 * Accepts an array of documents (or cursor materialized) with shape:
 *   { Agents: [{ "Agent Name": string, "Total Cost": string|number }, ...] }
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
        const display = String(nameRaw == null ? '' : nameRaw).trim() || 'Unknown';
        // Normalize key for grouping
        const key = display ? display.toLowerCase() : 'unknown';
        const cost = parseCurrencyToNumber(a?.['Total Cost']);
        const prev = totals.get(key) || { display, total: 0 };
        // Preserve first-seen display casing
        if (!prev.display) {prev.display = display;}
        prev.total += Number.isFinite(cost) ? cost : 0;
        totals.set(key, prev);
      } catch (e) {
         
        console.warn('[llmCost.service] Skipped malformed agent entry:', e?.message || e);
      }
    }
  }
  const arr = Array.from(totals.entries()).map(([, v]) => ({
    agent: v.display || 'Unknown',
    // Ensure 6-decimal precision using roundTo
    total_cost: roundTo(v.total, 6),
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
  const candidates = resolveCollectionCandidates();
  const collection = await getCollection(candidates);

  try {
    // First, try a flat schema pipeline (agent_name/agent/agentName/tool/metadata.* + cost_usd/total_cost/cost or cost.amount with currency USD)
    const flatPipeline = buildFlatAgentCostPipeline();
    const flatResults = await collection.aggregate(flatPipeline, { allowDiskUse: true }).toArray();

    if (Array.isArray(flatResults) && flatResults.length > 0) {
      const arr = flatResults.map((r) => ({
        agent: String(r?.agent ?? 'Unknown'),
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

    // If no results from either pipeline, log and return empty array
     
    console.info(
      `[llmCost.service] No results for collection "${collection?.collectionName || 'unknown'}" using flat/array pipelines. Candidates: ${candidates.join(', ')}. Set LLM_EVENTS_COLLECTION to override if needed.`
    );
    return [];
  } catch (err) {
     
    console.warn(
      `[llmCost.service] Aggregation pipeline failed for collection "${collection?.collectionName || 'unknown'}"; attempting in-app fallback:`,
      err?.message || err
    );
    try {
      // Fallback: fetch only Agents field to minimize payload when attempting in-app reduction
      const cursor = collection.find(
        { Agents: { $exists: true, $type: 'array' } },
        { projection: { Agents: 1 } }
      );
      const docs = await cursor.toArray();
      if (!docs || docs.length === 0) {
         
        console.info(
          `[llmCost.service] In-app fallback found no Agents[] documents in "${collection?.collectionName || 'unknown'}".`
        );
        return [];
      }
      return aggregateAgentsInApp(docs);
    } catch (e) {
      // Final safeguard: never throw to the caller; return empty list
       
      console.warn('[llmCost.service] In-app fallback failed:', e?.message || e);
      return [];
    }
  }
}

module.exports = {
  getLlmCostByAgent,
  aggregateAgentsInApp,
};
