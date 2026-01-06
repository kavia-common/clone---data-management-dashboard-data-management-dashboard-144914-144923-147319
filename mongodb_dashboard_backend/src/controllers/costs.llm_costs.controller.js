'use strict';

const LLMCost = require('../models/llmCosts.model'); // corrected path two-level up not needed; file resides in src/models
const { success } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs
 *
 * Implements a minimal, safe, and verifiable pipeline.
 * - Optional organization_id filter (?organization_id)
 * - IMPORTANT: returns ALL rows (no hard limit of 10)
 * - No malformed field paths: no stage contains a field path that is just '$'
 * - Adds diagnostics headers
 *
 * Notes:
 * - The UI Credits Consumed modal needs costs for all users; previously the endpoint
 *   defaulted to returning only the first 10 rows via pagination.
 * - For backward compatibility, we still accept page/limit query params but we do not
 *   apply them to the DB query. We still return meta.page/meta.limit/meta.total.
 */
async function getLlmCostsAggregated(req, res) {
  // Keep parsing these for backward compatibility in the response envelope,
  // but do NOT apply them to the aggregation anymore.
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limitRequested = Math.max(parseInt(req.query.limit, 10) || 10, 1);

  // ---------------------------------------------------------------------------
  // SUPER ADMIN CONTEXT: NO AUTH REQUIRED FOR /api/llm_costs
  // ---------------------------------------------------------------------------
  // This endpoint is used by the Super Admin Costs module and must be callable
  // without an Authorization header.
  //
  // Behavior:
  // - If an authenticated user is present, we scope to that user's nested users.user_id
  //   (backwards-compatible with prior hard-enforced scoping).
  // - If no authenticated user is present, we do NOT apply user_id scoping and return
  //   aggregated results across users (optionally filtered by organization_id).
  const authUserId =
    (req.user && (req.user.id || req.user._id)) ||
    (req.auth && (req.auth.sub || req.auth.user_id || req.auth.userId)) ||
    null;

  const userIdStr = authUserId ? String(authUserId).trim() : null;

  // Optional filter
  const organization_id = (req.query.organization_id || '').toString().trim();
  const matchStage = organization_id ? { $match: { organization_id: organization_id } } : { $match: {} };

  // Build pipeline with enrichment of user_name strictly from users.name using string equality (no ObjectId conversion)
  const pipeline = [
    ...(organization_id ? [{ $match: { organization_id } }] : []),

    // Unwind users for per-user grouping
    { $unwind: { path: '$users', preserveNullAndEmptyArrays: true } },

    // If authenticated, enforce user_id at the nested users level (string compare).
    // If unauthenticated (Super Admin Costs module context), do not apply user scoping.
    ...(userIdStr
      ? [
          {
            $match: {
              $expr: { $eq: [{ $toString: '$users.user_id' }, userIdStr] },
            },
          },
        ]
      : []),

    {
      $addFields: {
        user_cost_num: {
          $convert: {
            input: {
              $cond: [
                {
                  $and: [{ $ne: ['$users.user_cost', null] }, { $ne: ['$users.user_cost', ''] }],
                },
                { $substr: ['$users.user_cost', 1, -1] },
                '0',
              ],
            },
            to: 'double',
            onError: 0,
            onNull: 0,
          },
        },
      },
    },

    // Lookup user strictly by string _id using pipeline + $expr
    {
      $lookup: {
        from: 'users',
        let: { userId: '$users.user_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$_id', '$$userId'] },
            },
          },
          { $project: { _id: 1, name: 1 } },
        ],
        as: 'userDoc',
      },
    },

    // Add user_name from users.name (fallback Unknown User)
    {
      $addFields: {
        user_name: { $ifNull: [{ $arrayElemAt: ['$userDoc.name', 0] }, 'Unknown User'] },
      },
    },

    // Unwind projects (optional but needed for count)
    {
      $unwind: {
        path: '$users.projects',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users.projects.agents',
        preserveNullAndEmptyArrays: true,
      },
    },

    // Group per USER
    {
      $group: {
        _id: {
          organization_id: '$organization_id',
          organization_name: '$organization_name',
          organization_cost: '$organization_cost',
          user_id: '$users.user_id',
          type: '$users.type',
        },
        user_cost: { $first: '$user_cost_num' },
        user_name: { $first: '$user_name' },
        projectsSet: { $addToSet: '$users.projects.project_id' },

        agentsSet: {
          $addToSet: {
            $cond: [
              {
                $and: [
                  { $ne: ['$users.projects.agents.agent_name', null] },
                  { $ne: ['$users.projects.agents.agent_name', ''] },
                ],
              },
              '$users.projects.agents.agent_name',
              '$$REMOVE',
            ],
          },
        },
      },
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
        agents: {
          $ifNull: ['$agentsSet', []],
        },
        projects: {
          $size: {
            $filter: { input: '$projectsSet', as: 'p', cond: { $ne: ['$$p', null] } },
          },
        },
      },
    },

    { $sort: { user_cost: -1 } },
  ];

  // Execute (no pagination facet; return full dataset)
  const rows = await LLMCost.aggregate(pipeline, { allowDiskUse: true });

  const enriched = Array.isArray(rows) ? rows : [];
  const postGroupCount = enriched.length;

  // Diagnostics headers
  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
    // Matched pre-group docs requires separate count; keep lightweight by echoing filter only
    res.setHeader('X-LLM-COSTS-MatchedPreGroup', JSON.stringify(matchStage?.$match || {}));
    res.setHeader('X-LLM-COSTS-PostGroupCount', String(postGroupCount));
    if (userIdStr) {
      res.setHeader('X-LLM-COSTS-UserId', userIdStr);
    }
    if (!enriched.length) {
      res.setHeader('X-LLM-COSTS-Reason', 'Empty rows after aggregation.');
    }
  } catch {}

  // Response shape with meta
  // - meta.limit: use returned count so consumers that used `limit` can still render fully.
  return success(
    res,
    enriched,
    {
      page,
      limit: postGroupCount || limitRequested,
      total: postGroupCount,
      organization_id: organization_id || null,
    },
    200
  );
}

module.exports = { getLlmCostsAggregated };