'use strict';

const LLMCost = require('../models/llmCosts.model'); // corrected path two-level up not needed; file resides in src/models
const { success } = require('../utils/http');
const { deriveAgentName } = require('../utils/agentName');

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs
 *
 * Implements a minimal, safe, and verifiable pipeline.
 * - Optional organization_id filter (?organization_id)
 * - Pagination with defaults page=1, limit=10 (clamped to max 100)
 * - No malformed field paths: no stage contains a field path that is just '$'
 * - Adds diagnostics headers
 */
async function getLlmCostsAggregated(req, res) {
  // Parse pagination with clamping
  const maxLimit = 100;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
  const skip = (page - 1) * limit;

  // Optional filter
  const organization_id = (req.query.organization_id || '').toString().trim();
  const matchStage = organization_id
    ? { $match: { organization_id: organization_id } }
    : { $match: {} };

  // Build pipeline with enrichment of user_name strictly from users.name using string equality (no ObjectId conversion)
  const pipeline = [
    ...(organization_id ? [{ $match: { organization_id } }] : []),

    // Unwind users for per-user grouping
    { $unwind: { path: '$users', preserveNullAndEmptyArrays: true } },

    // Parse user cost; keep user_id as string for join
    {
      $addFields: {
        user_cost_num: {
          $toDouble: { $substr: ['$users.user_cost', 1, -1] }
        }
      }
    },

    // Lookup user strictly by string _id using pipeline + $expr
    {
      $lookup: {
        from: 'users',
        let: { userId: '$users.user_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$userId'] }
            }
          },
          { $project: { _id: 1, name: 1 } }
        ],
        as: 'userDoc'
      }
    },

    // Add user_name from users.name (fallback Unknown User)
    {
      $addFields: {
        user_name: { $ifNull: [{ $arrayElemAt: ['$userDoc.name', 0] }, 'Unknown User'] }
      }
    },

    // Unwind projects (optional but needed for count)
    {
      $unwind: {
        path: '$users.projects',
        preserveNullAndEmptyArrays: true
      }
    },

    // Group per USER
    {
      $group: {
        _id: {
          organization_id: '$organization_id',
          organization_name: '$organization_name',
          organization_cost: '$organization_cost',
          user_id: '$users.user_id',
          type: '$users.type'
        },
        user_cost: { $first: '$user_cost_num' },
        user_name: { $first: '$user_name' },
        projectsSet: { $addToSet: '$users.projects.project_id' }
      }
    },

    // Shape output with user_name included
    {
      $project: {
        _id: 0,
        organization_id: '$_id.organization_id',
        organization_name: '$_id.organization_name',
        organization_cost: '$_id.organization_cost',
        user_id: '$_id.user_id',
        user_name: 1,
        type: '$_id.type',
        user_cost: 1,
        projects: {
          $size: {
            $filter: { input: '$projectsSet', as: 'p', cond: { $ne: ['$$p', null] } }
          }
        }
      }
    },

    { $sort: { user_cost: -1 } },

    // Pagination + meta
    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: limit }],
        meta: [{ $count: 'total' }]
      }
    }
  ];


  // Execute
  const result = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
  const facet = Array.isArray(result) && result[0] ? result[0] : { rows: [], meta: [], orgMeta: [] };
  let rows = Array.isArray(facet.rows) ? facet.rows : [];

  // Append agent_name per row with fallbacks
  function fallbackAgentName(doc) {
    const names = [];
    if (Array.isArray(doc?.users)) {
      for (const u of doc.users) {
        const projects = Array.isArray(u?.projects) ? u.projects : [];
        for (const p of projects) {
          const agents = Array.isArray(p?.agents) ? p.agents : [];
          for (const a of agents) {
            if (!a || typeof a !== 'object') continue;
            const nm = (typeof a.agent_name === 'string' && a.agent_name.trim())
              ? a.agent_name.trim()
              : (typeof a.name === 'string' && a.name.trim() ? a.name.trim() : null);
            if (nm) names.push(nm);
          }
        }
      }
    }
    if (Array.isArray(doc?.agents)) {
      for (const a of doc.agents) {
        if (!a || typeof a !== 'object') continue;
        const nm = (typeof a.agent_name === 'string' && a.agent_name.trim())
          ? a.agent_name.trim()
          : (typeof a.name === 'string' && a.name.trim() ? a.name.trim() : null);
        if (nm) names.push(nm);
      }
    }
    const seen = new Set();
    for (const n of names) {
      const t = n.trim();
      if (t && !seen.has(t)) return t;
    }
    return null;
  }

  try {
    rows = rows.map((doc) => {
      const out = { ...doc };
      try {
        out.agent_name = deriveAgentName(doc) || fallbackAgentName(doc) || null;
      } catch { out.agent_name = fallbackAgentName(doc) || null; }
      return out;
    });
  } catch { /* defensive no-op */ }
  const metaArr = Array.isArray(facet.meta) ? facet.meta : [];
  const orgMetaArr = Array.isArray(facet.orgMeta) ? facet.orgMeta : [];
  const postGroupCount = metaArr[0]?.postGroupCount || 0;
  const orgMeta = orgMetaArr[0] || null;

  // Enrich rows with org-level info when available
  // const enriched = rows.map((r) => {
  //   if (orgMeta) {
  //     return {
  //       ...r,
  //       organization_cost: orgMeta.organization_cost ?? 0,
  //       users: orgMeta.users ?? 0,
  //     };
  //   }
  //   return { ...r, organization_cost: 0, users: 0 };
  // });
  const enriched = rows;


  // Diagnostics headers
  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
    // Matched pre-group docs requires separate count; keep lightweight by echoing filter only
    res.setHeader('X-LLM-COSTS-MatchedPreGroup', JSON.stringify(matchStage?.$match || {}));
    res.setHeader('X-LLM-COSTS-PostGroupCount', String(postGroupCount));
    if (!enriched.length) {
      res.setHeader('X-LLM-COSTS-Reason', 'Empty rows after aggregation.');
    }
  } catch { }

  // Diagnostics: count how many items have non-null agent_name
  try {
    const derivedCount = Array.isArray(enriched)
      ? enriched.reduce((acc, d) => acc + (d && typeof d.agent_name === 'string' && d.agent_name ? 1 : 0), 0)
      : 0;
    res.setHeader('x-agents-derived', String(derivedCount));
  } catch {}

  // Response shape with pagination meta
  return success(
    res,
    enriched,
    {
      page,
      limit,
      total: postGroupCount,
      organization_id: organization_id || null,
    },
    200
  );
}

module.exports = { getLlmCostsAggregated };