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

  // Build the minimal pipeline per spec
  const pipeline = [
    matchStage,
    {
      $project: {
        organization_id: 1,
        organization_name: 1,
        user_id: 1,
        type: 1,
        project_id: 1,
        cost: 1,
      },
    },
    {
      $group: {
        _id: {
          organization_id: '$organization_id',
          organization_name: '$organization_name',
          user_id: '$user_id',
          type: '$type',
        },
        user_cost: { $sum: { $ifNull: ['$cost', 0] } },
        projectsSet: { $addToSet: '$project_id' },
      },
    },
    {
      $project: {
        _id: 0,
        organization_id: '$_id.organization_id',
        organization_name: '$_id.organization_name',
        user_id: '$_id.user_id',
        type: '$_id.type',
        user_cost: 1,
        projects: { $size: '$projectsSet' },
      },
    },
    { $sort: { user_cost: -1, user_id: 1 } },
    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: limit }],
        meta: [{ $count: 'postGroupCount' }],
        orgMeta: [
          {
            $group: {
              _id: '$_id.organization_id',
              organization_cost: { $sum: '$user_cost' },
              usersSet: { $addToSet: '$_id.user_id' },
            },
          },
          {
            $project: {
              _id: 0,
              organization_cost: 1,
              users: { $size: '$usersSet' },
            },
          },
        ],
      },
    },
  ];

  // Execute
  const result = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
  const facet = Array.isArray(result) && result[0] ? result[0] : { rows: [], meta: [], orgMeta: [] };
  const rows = Array.isArray(facet.rows) ? facet.rows : [];
  const metaArr = Array.isArray(facet.meta) ? facet.meta : [];
  const orgMetaArr = Array.isArray(facet.orgMeta) ? facet.orgMeta : [];
  const postGroupCount = metaArr[0]?.postGroupCount || 0;
  const orgMeta = orgMetaArr[0] || null;

  // Enrich rows with org-level info when available
  const enriched = rows.map((r) => {
    if (orgMeta) {
      return {
        ...r,
        organization_cost: orgMeta.organization_cost ?? 0,
        users: orgMeta.users ?? 0,
      };
    }
    return { ...r, organization_cost: 0, users: 0 };
  });

  // Diagnostics headers
  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
    // Matched pre-group docs requires separate count; keep lightweight by echoing filter only
    res.setHeader('X-LLM-COSTS-MatchedPreGroup', JSON.stringify(matchStage?.$match || {}));
    res.setHeader('X-LLM-COSTS-PostGroupCount', String(postGroupCount));
    if (!enriched.length) {
      res.setHeader('X-LLM-COSTS-Reason', 'Empty rows after aggregation.');
    }
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
