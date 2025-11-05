'use strict';

const express = require('express');
const { bearerAuthAttach } = require('../middleware/jwtAuth');
const router = express.Router();
router.use(bearerAuthAttach());
const { asyncHandler } = require('../utils/http');
const { getCollection } = require('../config/db');

/**
 * Safely parse ISO date-like values
 */
function safeParseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * PUBLIC_INTERFACE
 * GET /api/costs/by-agent
 *
 * Minimal, safe aggregation to compute Top agents by total cost.
 *
 * Query params:
 * - tenant_id: optional string filter
 * - start: optional ISO date string (inclusive lower bound)
 * - end: optional ISO date string (inclusive upper bound)
 * - limit: optional integer, default 20, clamped to [1..100]
 *
 * Response:
 * {
 *   items: [ { agent_name: string, total: number } ],
 *   total: number,   // number of items returned
 *   limit: number    // applied limit
 * }
 */
router.get(
  '/by-agent',
  asyncHandler(async (req, res) => {
    // Clamp limit 1..100, default 20
    const limitRaw = parseInt(req.query?.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 20, 1), 100);

    const tenantId = req.query?.tenant_id;
    const startRaw = req.query?.start;
    const endRaw = req.query?.end;

    const start = safeParseDate(startRaw);
    const end = safeParseDate(endRaw);

    if ((startRaw && !start) || (endRaw && !end)) {
      return res.status(400).json({ success: false, message: 'Invalid ISO date in start/end query params' });
    }

    // Build a minimal $match (only tenant_id and date window if provided)
    const andConditions = [];
    if (tenantId != null && String(tenantId).trim() !== '') {
      andConditions.push({ tenant_id: String(tenantId) });
    }
    if (start || end) {
      const range = {};
      if (start) range.$gte = start;
      if (end) range.$lte = end;
      andConditions.push({
        $or: [
          { timestamp: range },
          { created_at: range },
          { updated_at: range },
          { createdAt: range },
          { date: range },
        ],
      });
    }

    const pipeline = [];

    if (andConditions.length > 0) {
      pipeline.push({ $match: { $and: andConditions } });
    }

    // Derive normalized agent name and numeric cost safely
    pipeline.push(
      {
        $addFields: {
          // agent_norm = trim(ifNull(agent_name, ifNull(agent, ifNull(tool, 'Unknown'))))
          agent_norm: {
            $trim: {
              input: {
                $ifNull: [
                  '$agent_name',
                  { $ifNull: ['$agent', { $ifNull: ['$tool', 'Unknown'] }] },
                ],
              },
            },
          },
          // total_num = ifNull(toDouble(ifNull(total_cost, ifNull(cost, 0))), 0)
          total_num: {
            $ifNull: [
              {
                $toDouble: {
                  $ifNull: ['$total_cost', { $ifNull: ['$cost', 0] }],
                },
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: '$agent_norm',
          total: { $sum: '$total_num' },
        },
      },
      {
        $project: {
          _id: 0,
          agent_name: '$_id',
          total: 1,
        },
      },
      { $sort: { total: -1 } },
      { $limit: limit }
    );

    // Resolve collection name: prefer 'llm-costs' then fallback to 'llm_costs'
    const collection = await getCollection(['llm-costs', 'llm_costs']);
    const items = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();

    return res.status(200).json({ items, total: items.length, limit });
  })
);

module.exports = router;
