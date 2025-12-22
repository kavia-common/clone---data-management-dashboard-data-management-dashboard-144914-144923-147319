'use strict';

const LLMCost = require('../models/llmCosts.model'); // model resides in src/models
const { success } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs
 *
 * Implements a minimal, safe pipeline and returns summary rows.
 * Note: agent_name is NOT derived here and no utilities are used for it.
 */
async function getLlmCostsAggregated(req, res) {
  // Parse pagination with clamping
  const maxLimit = 100;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
  const skip = (page - 1) * limit;

  // Optional filter
  const organization_id = (req.query.organization_id || '').toString().trim();

  // Build pipeline (no agent_name derivation)
  const pipeline = [
    ...(organization_id ? [{ $match: { organization_id } }] : []),

    { $unwind: { path: '$users', preserveNullAndEmptyArrays: true } },

    {
      $addFields: {
        user_cost_num: {
          $toDouble: { $substr: ['$users.user_cost', 1, -1] }
        }
      }
    },

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
        projectsSet: { $addToSet: '$users.projects.project_id' }
      }
    },

    {
      $project: {
        _id: 0,
        organization_id: '$_id.organization_id',
        organization_name: '$_id.organization_name',
        organization_cost: '$_id.organization_cost',
        user_id: '$_id.user_id',
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

    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: limit }],
        meta: [{ $count: 'total' }]
      }
    }
  ];

  // Execute
  const result = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
  const facet = Array.isArray(result) && result[0] ? result[0] : { rows: [], meta: [] };
  const rows = Array.isArray(facet.rows) ? facet.rows : [];
  const count = Array.isArray(facet.meta) && facet.meta[0] ? facet.meta[0].total || 0 : 0;

  // Diagnostics headers
  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
  } catch {}

  // Response shape with pagination meta
  return success(
    res,
    rows,
    {
      page,
      limit,
      total: count,
      organization_id: organization_id || null,
    },
    200
  );
}

module.exports = { getLlmCostsAggregated };