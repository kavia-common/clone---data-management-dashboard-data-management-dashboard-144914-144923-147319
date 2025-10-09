'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/http');
const { getCollection } = require('../config/db');

/**
 * Build a MongoDB $match stage from query filters with defensive parsing.
 * Supports: tenant_id, project_id, user_id, llm_model, start_date, end_date
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
        and.push({ $expr: { $eq: [{ $toString: '$user_id' }, String(val)] } });
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
  const start = parseDate(q.start_date);
  const end = parseDate(q.end_date);

  if ((q.start_date && !start) || (q.end_date && !end)) {
    const err = new Error('Invalid ISO date in start_date/end_date');
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
 * - start_date, end_date (ISO strings)
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

      // Project normalized agent name and prepare likely cost fields
      {
        $project: {
          // Pick best-effort agent name from multiple possible fields
          agent_name: {
            $ifNull: [
              '$agent_name',
              {
                $ifNull: [
                  '$agent',
                  { $ifNull: ['$service_type', { $ifNull: ['$operation', 'unknown'] }] },
                ],
              },
            ],
          },
          // Common variants for cost fields
          total_cost: '$total_cost',
          cost: '$cost',
          costUSD: '$costUSD',
          cost_usd: '$cost_usd',
          usage_cost: '$usage.cost',
        },
      },

      // Coerce cost to number with defensive handling (no bare '$' field paths)
      // total_num = $ifNull([$toDouble($ifNull(['$total_cost', '$cost', 0])), 0])
      // plus additional fallbacks: costUSD, cost_usd, usage.cost
      {
        $addFields: {
          total_num: {
            $ifNull: [
              {
                $toDouble: {
                  $ifNull: [
                    '$total_cost',
                    {
                      $ifNull: [
                        '$cost',
                        {
                          $ifNull: [
                            '$costUSD',
                            {
                              $ifNull: ['$cost_usd', { $ifNull: ['$usage_cost', 0] }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
              0,
            ],
          },
        },
      },

      // Group by agent_name
      {
        $group: {
          _id: { $ifNull: ['$agent_name', 'unknown'] },
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

    // Return shape compatible with frontend and instruction
    return res.status(200).json({ items, total: items.length, limit, meta: { limit } });
  })
);

module.exports = router;
