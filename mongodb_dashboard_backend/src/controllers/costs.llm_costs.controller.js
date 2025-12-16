'use strict';

const LLMCost = require('../models/llmCosts.model');
const { success } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs
 *
 * Implements the specified minimal, safe, nested-aware aggregation pipeline.
 * Ensures:
 * - No bare "$" in any path
 * - Proper parsing of currency strings (stripping "$")
 * - Pagination with page>=1 default 1; limit>=1 default 10 capped to 100
 * - Diagnostics headers with pre-group match count and post-group count
 */
async function getLlmCostsAggregated(req, res) {
  const MAX_LIMIT = 100;

  // Parse pagination inputs with defaults and clamping
  const pageRaw = parseInt(req.query.page, 10);
  const limitRaw = parseInt(req.query.limit, 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, MAX_LIMIT) : 10;
  const SKIP = (page - 1) * limit;
  const LIMIT = limit;

  // Inputs
  const organization_id = (req.query.organization_id || '').toString().trim() || undefined;

  // Stage 1: matchStage per spec
  const matchStage = organization_id ? { $match: { organization_id } } : { $match: {} };

  // Build exact pipeline per instructions (no bare "$")
  const pipeline = [
    matchStage,
    {
      $project: {
        organization_id: 1,
        organization_name: 1,
        usersSafe: { $ifNull: ['$users', []] },
        projectsTop: {
          $cond: [
            { $isArray: '$projects' },
            { $ifNull: ['$projects', []] },
            [],
          ],
        },
      },
    },
    {
      $project: {
        organization_id: 1,
        organization_name: 1,
        usersCount: { $size: '$usersSafe' },
        projectsFromUsers: {
          $sum: {
            $map: {
              input: '$usersSafe',
              as: 'u',
              in: { $size: { $ifNull: ['$$u.projects', []] } },
            },
          },
        },
        usersCost: {
          $sum: {
            $map: {
              input: '$usersSafe',
              as: 'u',
              in: {
                $toDouble: {
                  $replaceAll: {
                    input: { $ifNull: ['$$u.user_cost', '0'] },
                    find: '$',
                    replacement: '',
                  },
                },
              },
            },
          },
        },
        projectsTopCount: { $size: '$projectsTop' },
      },
    },
    {
      $addFields: {
        projectsCount: { $add: ['$projectsFromUsers', '$projectsTopCount'] },
      },
    },
    {
      $group: {
        _id: { organization_id: '$organization_id', organization_name: '$organization_name' },
        organization_cost: { $sum: '$usersCost' },
        users: { $sum: '$usersCount' },
        projects: { $sum: '$projectsCount' },
      },
    },
    {
      $project: {
        _id: 0,
        organization_id: '$_id.organization_id',
        organization_name: '$_id.organization_name',
        organization_cost: 1,
        users: 1,
        projects: 1,
        cost: '$organization_cost',
      },
    },
    { $sort: { organization_cost: -1, organization_id: 1 } },
    {
      $facet: {
        rows: [{ $skip: SKIP }, { $limit: LIMIT }],
        meta: [{ $count: 'total' }],
      },
    },
  ];

  // Pre-group matched count (quick count using match only)
  let matchedPreGroup = 0;
  try {
    const preMatch = matchStage.$match || {};
    matchedPreGroup = await LLMCost.countDocuments(preMatch);
  } catch (err) {
    // ignore diagnostics failure
  }

  // Execute aggregation
  const [facet] = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
  const rows = (facet && Array.isArray(facet.rows)) ? facet.rows : [];
  const total = (facet && Array.isArray(facet.meta) && facet.meta[0]?.total) ? facet.meta[0].total : 0;

  // Diagnostics headers
  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
    res.setHeader('X-LLM-COSTS-MatchedPreGroup', String(matchedPreGroup));
    res.setHeader('X-LLM-COSTS-PostGroupCount', String(total));
    if (rows.length === 0) {
      res.setHeader('X-LLM-COSTS-Reason', 'No rows after aggregation facet pagination or no matching documents.');
    }
  } catch {}

  // Return envelope
  return success(
    res,
    rows,
    { page, limit, total },
    200
  );
}

module.exports = { getLlmCostsAggregated };
