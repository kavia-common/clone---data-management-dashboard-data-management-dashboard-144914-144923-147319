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
  const start = q.start_date ? new Date(q.start_date) : null;
  const end = q.end_date ? new Date(q.end_date) : null;

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
 *   items: [ { agent_name: string, total_cost: number } ],
 *   meta: { limit: number }
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

      // Project normalized agent name and numeric total cost
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
          raw_cost: {
            $ifNull: [
              '$total_cost',
              {
                $ifNull: [
                  '$cost',
                  { $ifNull: ['$costUSD', { $ifNull: ['$cost_usd', { $ifNull: ['$usage.cost', 0] }] }] },
                ],
              },
            ],
          },
        },
      },
      // Coerce cost to number with defensive handling (strip $ if needed)
      {
        $addFields: {
          total_cost_num: {
            $convert: {
              input: {
                $cond: [
                  { $isNumber: '$raw_cost' },
                  '$raw_cost',
                  {
                    $cond: [
                      {
                        $and: [
                          { $eq: [{ $type: '$raw_cost' }, 'string'] },
                          { $eq: [{ $substrCP: ['$raw_cost', 0, 1] }, '$'] },
                        ],
                      },
                      { $substrCP: ['$raw_cost', 1, { $strLenCP: '$raw_cost' }] },
                      { $toString: '$raw_cost' },
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
      // Group by agent_name
      {
        $group: {
          _id: { $ifNull: ['$agent_name', 'unknown'] },
          total_cost: { $sum: '$total_cost_num' },
        },
      },
      // Shape and round
      {
        $project: {
          _id: 0,
          agent_name: '$_id',
          total_cost: { $round: ['$total_cost', 6] },
        },
      },
      { $sort: { total_cost: -1 } },
      { $limit: limit },
    ];

    // Resolve collection: prefer 'llm-costs' then fallback 'llm_costs'
    const collection = await getCollection(['llm-costs', 'llm_costs']);
    const items = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();

    return res.status(200).json({ items, total: items.length, meta: { limit } });
  })
);

module.exports = router;
