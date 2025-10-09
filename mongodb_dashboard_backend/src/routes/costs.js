'use strict';

const express = require('express');
const router = express.Router();
const { getCollection } = require('../config/db');
const { asyncHandler } = require('../utils/http');
const { resolveProjectNames } = require('../services/projects.service');
const { usdToCredits } = require('../utils/credits');

/**
 * Utility: parse an ISO date-time string defensively.
 */
function parseIsoDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * PUBLIC_INTERFACE
 * GET /api/costs/details
 * Returns a normalized payload of LLM costs grouped by user -> projects -> agents with per-date breakdowns.
 *
 * Query parameters:
 * - userId: optional string to scope aggregation to a single user (normalized via $toString)
 * - from: optional ISO date string (inclusive lower bound)
 * - to: optional ISO date string (inclusive upper bound)
 *
 * Response (when userId provided):
 *  {
 *    userId: "u-123",
 *    userName: "Jane Doe" | null,
 *    totalProjectCount: 2,
 *    totalCostUSD: 12.34,
 *    projects: [
 *      {
 *        projectId: "p-1",
 *        projectName: "Project One" | null,
 *        projectCost: 10.5,
 *        agents: [
 *          {
 *            agentId: "agent-xyz",
 *            agentName: "agent-xyz",
 *            costByDate: { "2025-09-30": 3.25, "2025-10-01": 7.25 },
 *            tokensByDate: { "2025-09-30": 1200, "2025-10-01": 980 }
 *          }
 *        ]
 *      }
 *    ]
 *  }
 *
 * If userId is not provided, returns an array of the above objects, one per user:
 *  [ { userId, userName, ... }, ... ]
 *
 * Error cases:
 * - 400 when from/to dates are invalid
 * - 404 when no data is found for the requested filter
 */
router.get(
  '/details',
  asyncHandler(async (req, res) => {
    const { userId } = req.query || {};
    const from = parseIsoDate(req.query?.from);
    const to = parseIsoDate(req.query?.to);

    if ((req.query?.from && !from) || (req.query?.to && !to)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid ISO date in from/to query params' });
    }

    // Build aggregation pipeline with defensive normalization
    const pipeline = [
      // Project and normalize common variants
      {
        $project: {
          user_id_str: {
            $toString: {
              $ifNull: [
                '$user_id',
                {
                  $ifNull: [
                    '$userId',
                    { $ifNull: ['$user', { $ifNull: ['$user_uuid', '$user_uuid_str'] }] },
                  ],
                },
              ],
            },
          },
          user_name: {
            $ifNull: ['$user_name', { $ifNull: ['$userName', { $ifNull: ['$name', null] }] }],
          },
          project_id_str: {
            $toString: {
              $ifNull: [
                '$project_id',
                { $ifNull: ['$projectId', { $ifNull: ['$project', '$project_code'] }] },
              ],
            },
          },
          project_name_raw: { $ifNull: ['$project_name', { $ifNull: ['$projectName', null] }] },
          agent_id_raw: {
            $ifNull: ['$agent_id', { $ifNull: ['$agentId', { $ifNull: ['$agent', '$agent_name'] }] }],
          },
          agent_name: {
            $ifNull: ['$agent_name', { $ifNull: ['$agent', { $ifNull: ['$service_type', '$operation'] }] }],
          },
          input_tokens: {
            $ifNull: [
              '$input_tokens',
              { $ifNull: ['$usage.input_tokens', { $ifNull: ['$tokens_in', { $ifNull: ['$tokens_input', 0] }] }] },
            ],
          },
          output_tokens: {
            $ifNull: [
              '$output_tokens',
              { $ifNull: ['$usage.output_tokens', { $ifNull: ['$tokens_out', { $ifNull: ['$tokens_output', 0] }] }] },
            ],
          },
          tokens_field: { $ifNull: ['$tokens', { $ifNull: ['$token_count', null] }] },
          dateRaw: {
            $ifNull: [
              '$date',
              {
                $ifNull: [
                  '$createdAt',
                  { $ifNull: ['$timestamp', { $ifNull: ['$created_at', '$updated_at'] }] },
                ],
              },
            ],
          },
          cost_raw: {
            $ifNull: [
              '$costUSD',
              {
                $ifNull: [
                  '$cost_usd',
                  { $ifNull: ['$cost', { $ifNull: ['$total_cost', { $ifNull: ['$usage.cost', 0] }] }] },
                ],
              },
            ],
          },
        },
      },
      // Derive dateObj, numeric cost, numeric tokens, dateKey
      {
        $addFields: {
          dateObj: {
            $cond: [{ $eq: [{ $type: '$dateRaw' }, 'string'] }, { $toDate: '$dateRaw' }, '$dateRaw'],
          },
          total_cost_num: {
            $convert: {
              input: {
                $cond: [
                  { $isNumber: '$cost_raw' },
                  '$cost_raw',
                  {
                    $cond: [
                      {
                        $and: [
                          { $eq: [{ $type: '$cost_raw' }, 'string'] },
                          { $eq: [{ $substrCP: ['$cost_raw', 0, 1] }, '$'] },
                        ],
                      },
                      { $substrCP: ['$cost_raw', 1, { $strLenCP: '$cost_raw' }] },
                      { $toString: '$cost_raw' },
                    ],
                  },
                ],
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
          tokens_num: {
            $cond: [
              { $ne: ['$tokens_field', null] },
              {
                $convert: {
                  input: {
                    $cond: [
                      { $isNumber: '$tokens_field' },
                      '$tokens_field',
                      { $toString: '$tokens_field' },
                    ],
                  },
                  to: 'double',
                  onError: 0,
                  onNull: 0,
                },
              },
              { $add: [{ $ifNull: ['$input_tokens', 0] }, { $ifNull: ['$output_tokens', 0] }] },
            ],
          },
        },
      },
      {
        $addFields: {
          dateKey: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: { $ifNull: ['$dateObj', new Date(0)] },
            },
          },
        },
      },
    ];

    // Apply filters now that we have normalized fields
    const matchConditions = [];
    if (userId) {
      matchConditions.push({ $expr: { $eq: ['$user_id_str', String(userId)] } });
    }
    if (from || to) {
      const range = {};
      if (from) range.$gte = from;
      if (to) range.$lte = to;
      matchConditions.push({ dateObj: range });
    }
    if (matchConditions.length > 0) {
      pipeline.push({ $match: { $and: matchConditions } });
    }

    // Group by user+project+agent+date
    pipeline.push(
      {
        $group: {
          _id: {
            user_id: '$user_id_str',
            project_id: '$project_id_str',
            agent_id: { $ifNull: ['$agent_id_raw', '$agent_name'] },
            dateKey: '$dateKey',
          },
          day_cost: { $sum: '$total_cost_num' },
          day_tokens: { $sum: '$tokens_num' },
          user_name: { $first: '$user_name' },
          agent_name: { $first: '$agent_name' },
          project_name_raw: { $first: '$project_name_raw' },
        },
      },
      // Group by agent (within project)
      {
        $group: {
          _id: {
            user_id: '$_id.user_id',
            project_id: '$_id.project_id',
            agent_id: '$_id.agent_id',
          },
          user_name: { $first: '$user_name' },
          agent_name: { $first: '$agent_name' },
          project_name_raw: { $first: '$project_name_raw' },
          agent_cost: { $sum: '$day_cost' },
          costByDateArr: { $push: { k: '$_id.dateKey', v: { $round: ['$day_cost', 6] } } },
          tokensByDateArr: { $push: { k: '$_id.dateKey', v: '$day_tokens' } },
        },
      },
      {
        $project: {
          _id: 0,
          user_id: '$_id.user_id',
          project_id: '$_id.project_id',
          agent: {
            agentId: '$_id.agent_id',
            agentName: '$agent_name',
            costByDate: { $arrayToObject: '$costByDateArr' },
            tokensByDate: { $arrayToObject: '$tokensByDateArr' },
            total_cost: { $round: ['$agent_cost', 6] },
          },
          user_name: 1,
          project_name_raw: 1,
        },
      },
      // Group by project
      {
        $group: {
          _id: { user_id: '$user_id', project_id: '$project_id' },
          user_name: { $first: '$user_name' },
          project_name_raw: { $first: '$project_name_raw' },
          project_cost: { $sum: '$agent.total_cost' },
          agents: { $push: '$agent' },
        },
      },
      {
        $project: {
          _id: 0,
          user_id: '$_id.user_id',
          projectId: '$_id.project_id',
          projectName: '$project_name_raw',
          projectCost: { $round: ['$project_cost', 6] },
          agents: 1,
          user_name: 1,
        },
      },
      // Group by user
      {
        $group: {
          _id: '$user_id',
          user_name: { $first: '$user_name' },
          totalCostUSD: { $sum: '$projectCost' },
          projects: {
            $push: {
              projectId: '$projectId',
              projectName: '$projectName',
              projectCost: '$projectCost',
              agents: '$agents',
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          userName: '$user_name',
          totalProjectCount: { $size: '$projects' },
          totalCostUSD: { $round: ['$totalCostUSD', 6] },
          projects: 1,
        },
      }
    );

    // Resolve the correct collection name: prefer 'llm-costs' but support legacy 'llm_costs'
    let agg;
    try {
      const collection = await getCollection(['llm-costs', 'llm_costs']);
      const cursor = collection.aggregate(pipeline, { allowDiskUse: true });
      agg = await cursor.toArray();
    } catch (e) {
      if (e && e.code === 'COLLECTION_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message:
            'Costs collection not found. Expected \'llm-costs\' (preferred) or \'llm_costs\' (legacy). Please ensure the collection exists and is correctly named.',
          detail: e.message,
        });
      }
      throw e;
    }

    if (!agg || agg.length === 0) {
      return res.status(404).json({ success: false, message: 'No cost data found' });
    }

    // If userId is specified, we expect a single object; otherwise return an array of users.
    const results = Array.isArray(agg) ? agg : [agg];

    // Resolve missing project names using the resolver service
    const allProjectIds = [];
    results.forEach((u) => {
      (u.projects || []).forEach((p) => {
        if (!p.projectName && p.projectId) {
          allProjectIds.push(p.projectId);
        }
      });
    });

    let resolvedMap = new Map();
    if (allProjectIds.length > 0) {
      try {
        resolvedMap = await resolveProjectNames(allProjectIds);
      } catch {
        // If resolver fails, keep nulls; do not break response
      }
    }

    const attachResolvedNames = (u) => {
      const projects = (u.projects || []).map((p) => {
        let projectName = p.projectName || null;
        if (!projectName && p.projectId && resolvedMap.has(p.projectId)) {
          projectName = resolvedMap.get(p.projectId);
        }
        // Normalize agents structure and ensure numeric values
        const agents = (p.agents || []).map((a) => {
          // Flatten and ensure defaults
          const costByDate = a.costByDate || {};
          // Also provide credits per day for convenience
          const costByDateCredits = Object.fromEntries(
            Object.entries(costByDate).map(([k, v]) => [k, usdToCredits(Number(v || 0))])
          );
          const totalCredits = usdToCredits(Number(a.total_cost || a.totalCost || 0));
          return {
            agentId: a.agentId || a.agent_id || a.agentName || 'unknown',
            agentName: a.agentName || 'unknown',
            costByDate,
            costByDateCredits,
            tokensByDate: a.tokensByDate || {},
            totalCredits,
          };
        });

        const projectCost = Number(p.projectCost || 0);
        const projectCredits = usdToCredits(projectCost);

        // Provide both snake_case and camelCase for compatibility with different clients
        return {
          projectId: p.projectId,
          projectName,
          projectCost,
          projectCredits,
          credits_used: projectCredits,
          creditsUsed: projectCredits,
          agents,
        };
      });

      const totalCostUSD = Number(u.totalCostUSD || 0);
      const totalCredits = usdToCredits(totalCostUSD);

      // Provide both snake_case and camelCase for compatibility with different clients
      return {
        userId: String(u.userId),
        userName: u.userName || null,
        totalProjectCount: Number(u.totalProjectCount || projects.length),
        totalCostUSD,
        totalCredits,
        credits_used: totalCredits,
        creditsUsed: totalCredits,
        projects,
      };
    };

    if (userId) {
      // Return a single object for modal consumption
      const one = attachResolvedNames(results[0]);
      return res.status(200).json(one);
    }

    // Return array of user summaries
    const normalized = results.map(attachResolvedNames);
    return res.status(200).json(normalized);
  })
);

module.exports = router;
