'use strict';

const LLMCost = require('../models/llmCosts.model');
const { success } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs
 *
 * - Optional organization_id filter
 * - Pagination (page, limit)
 * - Aggregates per user
 * - Correctly derives agent_name from projects.agents BEFORE grouping
 */
async function getLlmCostsAggregated(req, res) {
  // Pagination
  const maxLimit = 100;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
  const skip = (page - 1) * limit;

  // Optional filter
  const organization_id = (req.query.organization_id || '').toString().trim();
  const matchStage = organization_id ? [{ $match: { organization_id } }] : [];

  const pipeline = [
    ...matchStage,

    // Unwind users
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true
      }
    },

    // Parse user cost
    {
      $addFields: {
        user_cost_num: {
          $toDouble: { $substr: ['$users.user_cost', 1, -1] }
        }
      }
    },

    // Lookup user name
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

    // Attach user_name
    {
      $addFields: {
        user_name: {
          $ifNull: [{ $arrayElemAt: ['$userDoc.name', 0] }, 'Unknown User']
        }
      }
    },

    // Unwind projects
    {
      $unwind: {
        path: '$users.projects',
        preserveNullAndEmptyArrays: true
      }
    },

    // 🔥 UNWIND AGENTS (THIS FIXES agent_name)
    {
      $unwind: {
        path: '$users.projects.agents',
        preserveNullAndEmptyArrays: true
      }
    },

    // Group per USER (while agents are still present)
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
        agentsSnapshot: { $first: '$users.projects.agents' },
        projectsSet: { $addToSet: '$users.projects.project_id' },
        agentNames: { $addToSet: '$users.projects.agents.agent_name' }
      }
    },

    // Shape response
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
        agents: '$agentsSnapshot',
        projects: {
          $size: {
            $filter: {
              input: '$projectsSet',
              as: 'p',
              cond: { $ne: ['$$p', null] }
            }
          }
        },
        agent_name: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$agentNames',
                as: 'a',
                cond: { $ne: ['$$a', null] }
              }
            },
            0
          ]
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

  // Execute aggregation
  const result = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
  const facet = result?.[0] || { rows: [], meta: [] };

  const rows = facet.rows || [];
  const total = facet.meta?.[0]?.total || 0;

  // Diagnostics headers
  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
    res.setHeader('X-LLM-COSTS-MatchedPreGroup', JSON.stringify(organization_id ? { organization_id } : {}));
    res.setHeader('X-LLM-COSTS-PostGroupCount', String(total));
    if (!rows.length) {
      res.setHeader('X-LLM-COSTS-Reason', 'Empty rows after aggregation.');
    }
  } catch {
    /* no-op */
  }

  // Final response
  return success(
    res,
    rows,
    {
      page,
      limit,
      total,
      organization_id: organization_id || null
    },
    200
  );
}

module.exports = { getLlmCostsAggregated };
