'use strict';

const express = require('express');
const LLMCost = require('../models/llmCosts.model');
const { asyncHandler, success } = require('../utils/http');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Robust org-level aggregation supporting nested and flat shapes.
 * - Optional organization_id scoping
 * - Pagination (page>=1, limit<=100)
 * - Diagnostics headers for mode and matched counts
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Parse pagination with clamping
    const maxLimit = 100;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
    const skip = (page - 1) * limit;

    // Optional exact organization_id filter
    const organization_id = (req.query.organization_id || '').toString().trim();

    // Build match stage
    const matchStage = organization_id ? { $match: { organization_id } } : { $match: {} };

    // Helper expressions for currency parsing: safely remove "$" and coerce to double
    const toDoubleOf = (inputExpr) => ({
      $toDouble: {
        $replaceAll: {
          input: { $ifNull: [inputExpr, '0'] },
          find: '$',
          replacement: '',
        },
      },
    });

    // Single robust pipeline:
    const pipeline = [
      matchStage,

      // Compute helper fields strictly avoiding any bare '$' paths
      {
        $addFields: {
          parsedOrgCost: toDoubleOf('$organization_cost'),
          usersArray: { $ifNull: ['$users', []] },
          usersCount: { $size: { $ifNull: ['$users', []] } },

          // Sum over users[].user_cost
          usersCost: {
            $reduce: {
              input: { $ifNull: ['$users', []] },
              initialValue: 0,
              in: {
                $add: [
                  '$$value',
                  toDoubleOf('$$this.user_cost'),
                ],
              },
            },
          },

          // users[].projects arrays -> flattened
          usersProjectsArrays: {
            $map: {
              input: { $ifNull: ['$users', []] },
              as: 'u',
              in: { $ifNull: ['$$u.projects', []] },
            },
          },
        },
      },
      {
        $addFields: {
          projectsFlat: {
            $reduce: {
              input: '$usersProjectsArrays',
              initialValue: [],
              in: { $concatArrays: ['$$value', '$$this'] },
            },
          },
        },
      },
      {
        $addFields: {
          projectsCountFromUsers: { $size: '$projectsFlat' },
          projectsCostFromUsers: {
            $reduce: {
              input: '$projectsFlat',
              initialValue: 0,
              in: {
                $add: [
                  '$$value',
                  toDoubleOf('$$this.project_cost'),
                ],
              },
            },
          },
          agentsArrays: {
            $map: {
              input: '$projectsFlat',
              as: 'p',
              in: { $ifNull: ['$$p.agents', []] },
            },
          },
        },
      },
      {
        $addFields: {
          agentsFlat: {
            $reduce: {
              input: '$agentsArrays',
              initialValue: [],
              in: { $concatArrays: ['$$value', '$$this'] },
            },
          },
        },
      },
      {
        $addFields: {
          agentsCost: {
            $reduce: {
              input: '$agentsFlat',
              initialValue: 0,
              in: {
                $add: [
                  '$$value',
                  toDoubleOf('$$this.total_cost'),
                ],
              },
            },
          },
          topLevelProjectsCount: {
            $cond: [{ $isArray: '$projects' }, { $size: '$projects' }, 0],
          },
        },
      },
      {
        $addFields: {
          // Prefer users' nested projects count if present, else top-level projects array size
          projectsCount: {
            $cond: [
              { $gt: ['$projectsCountFromUsers', 0] },
              '$projectsCountFromUsers',
              '$topLevelProjectsCount',
            ],
          },

          // Coalesce org cost sources in preference order
          organization_cost_numeric: {
            $cond: [
              { $gt: ['$parsedOrgCost', 0] },
              '$parsedOrgCost',
              {
                $cond: [
                  { $gt: ['$usersCost', 0] },
                  '$usersCost',
                  {
                    $cond: [
                      { $gt: ['$projectsCostFromUsers', 0] },
                      '$projectsCostFromUsers',
                      '$agentsCost',
                    ],
                  },
                ],
              },
            ],
          },
        },
      },

      // Project to a normalized per-document shape
      {
        $project: {
          organization_id: 1,
          organization_name: 1,
          organization_cost: '$organization_cost_numeric',
          users: '$usersCount',
          projects: '$projectsCount',
          cost: '$organization_cost_numeric',
        },
      },

      // In case multiple documents exist per organization, consolidate
      {
        $group: {
          _id: { organization_id: '$organization_id', organization_name: '$organization_name' },
          organization_cost: { $sum: '$organization_cost' },
          users: { $max: '$users' },
          projects: { $max: '$projects' },
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

      // Sort and paginate
      { $sort: { organization_cost: -1, organization_id: 1 } },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: limit }],
          meta: [{ $count: 'total' }],
        },
      },
    ];

    const [facet] = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
    const rows = (facet && Array.isArray(facet.rows)) ? facet.rows : [];
    const total = (facet && Array.isArray(facet.meta) && facet.meta[0]?.total) ? facet.meta[0].total : 0;

    // Diagnostics headers
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Matched', JSON.stringify(matchStage.$match || {}));
      res.setHeader('X-LLM-COSTS-Total', String(total));
    } catch {}

    // Envelope response
    return success(
      res,
      rows.map(r => ({
        organization_id: r.organization_id,
        organization_name: r.organization_name ?? null,
        organization_cost: r.organization_cost ?? 0,
        users: r.users ?? 0,
        projects: r.projects ?? 0,
        cost: r.cost ?? r.organization_cost ?? 0,
      })),
      { page, limit, total },
      200
    );
  })
);

module.exports = router;
