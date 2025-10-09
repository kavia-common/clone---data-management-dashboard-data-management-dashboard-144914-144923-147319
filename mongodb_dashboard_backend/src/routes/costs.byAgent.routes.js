'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/http');
const { getCollection } = require('../config/db');

/**
 * Build a MongoDB $match stage from query filters with defensive parsing.
 * Supports: tenant_id, project_id, user_id, llm_model, start/start_date, end/end_date
 */
function buildMatchFromQuery(q = {}) {
  const and = [];

  // Direct equals matches on simple fields (string coercion)
  const eqFields = ['tenant_id', 'project_id', 'user_id', 'llm_model'];
  eqFields.forEach((field) => {
    const val = q[field];
    if (val != null && String(val).trim() !== '') {
      if (field === 'user_id') {
        // Some datasets store user_id as string or ObjectId-mixed. Normalize via $toString match in pipeline elsewhere.
        and.push({ $expr: { $eq: [{ $toString: '$user_id' }, String(val) ] } });
      } else {
        and.push({ [field]: String(val) });
      }
    }
  });

  // Time range: prefer 'timestamp' field but be flexible
  const parseDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  // Accept both start/end and start_date/end_date
  const startRaw = q.start ?? q.start_date;
  const endRaw = q.end ?? q.end_date;

  const start = parseDate(startRaw);
  const end = parseDate(endRaw);

  if ((startRaw && !start) || (endRaw && !end)) {
    const err = new Error('Invalid ISO date in start/end (or start_date/end_date)');
    err.status = 400;
    throw err;
  }

  if (start || end) {
    const range = {};
    if (start) range.$gte = start;
    if (end) range.$lte = end;
    and.push({
      $or: [
        { timestamp: range },
        { created_at: range },
        { updated_at: range },
        { createdAt: range },
        { date: range },
      ],
    });
  }

  return and.length ? { $and: and } : {};
}

/**
 * PUBLIC_INTERFACE
 * GET /api/costs/by-agent
 * Aggregate total costs grouped by agent_name (or suitable fallback) and return top agents.
 *
 * Query params:
 * - tenant_id, project_id, user_id, llm_model (string exact matches)
 * - start, end (or start_date, end_date) ISO strings
 * - limit (number, default 10, max 100)
 *
 * Response:
 * {
 *   items: [ { agent_name: string, total: number, total_cost: number } ],
 *   total: number, // number of agents returned
 *   limit: number, // requested limit
 *   meta: { limit: number } // kept for backward compatibility with frontend
 * }
 */
router.get(
  '/by-agent',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 10, 1), 100);

    // Normalize and create pipeline
    const match = buildMatchFromQuery(req.query || {});

    const pipeline = [
      // Pre-filter if any
      ...(Object.keys(match).length ? [{ $match: match }] : []),

      // Project normalized agent candidate fields and cost candidates
      {
        $project: {
          // Agent candidates
          agent_candidate: {
            $ifNull: [
              '$agent_name',
              {
                $ifNull: [
                  '$agent',
                  {
                    $ifNull: [
                      '$tool',
                      {
                        $ifNull: [
                          '$agentName',
                          { $ifNull: ['$service_type', { $ifNull: ['$operation', null] }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          // Cost candidates
          cost_total_cost: '$total_cost',
          cost_cost: '$cost',
          cost_costUSD: '$costUSD',
          cost_cost_usd: '$cost_usd',
          cost_usage_cost: '$usage.cost',
          cost_usd: '$usd', // some datasets may use 'usd'
          cost_price: '$price',
          cost_amount: '$amount',
        },
      },

      // Derive normalized agent_name and numeric total
      {
        $addFields: {
          // Trim and fallback to "Unknown" if empty or null
          agent_name: {
            $let: {
              vars: {
                raw: {
                  $cond: [
                    { $eq: [{ $type: '$agent_candidate' }, 'string'] },
                    { $trim: { input: '$agent_candidate' } },
                    '$agent_candidate',
                  ],
                },
              },
              in: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$$raw', null] },
                      { $eq: ['$$raw', ''] },
                    ],
                  },
                  'Unknown',
                  '$$raw',
                ],
              },
            },
          },
          // Build a single raw cost value preferring total_cost, cost, costUSD, cost_usd, usage.cost, usd, price, amount
          cost_raw: {
            $ifNull: [
              '$cost_total_cost',
              {
                $ifNull: [
                  '$cost_cost',
                  {
                    $ifNull: [
                      '$cost_costUSD',
                      {
                        $ifNull: [
                          '$cost_cost_usd',
                          {
                            $ifNull: [
                              '$cost_usage_cost',
                              { $ifNull: ['$cost_usd', { $ifNull: ['$cost_price', { $ifNull: ['$cost_amount', 0] }] }] },
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

      // Safe numeric coercion for cost (supports strings like "$0.10")
      {
        $addFields: {
          total_num: {
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
        },
      },

      // Group by normalized agent_name
      {
        $group: {
          _id: { $ifNull: ['$agent_name', 'Unknown'] },
          total: { $sum: '$total_num' },
        },
      },

      // Shape output, include both "total" and "total_cost" for frontend compatibility
      {
        $project: {
          _id: 0,
          agent_name: '$_id',
          total: { $round: ['$total', 6] },
          total_cost: { $round: ['$total', 6] },
        },
      },

      // Sorting and limit for Top N
      { $sort: { total: -1 } },
      { $limit: limit },
    ];

    // Resolve collection: prefer 'llm-costs' then fallback 'llm_costs'
    const collection = await getCollection(['llm-costs', 'llm_costs']);
    const items = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();

    return res.status(200).json({ items, total: items.length, limit, meta: { limit } });
  })
);

module.exports = router;
