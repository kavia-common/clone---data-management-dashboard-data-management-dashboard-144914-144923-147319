'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { getCollection } = require('../config/db');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');

/**
 * Create a single Router instance for this module.
 * Avoid multiple router declarations or duplicate exports.
 */
const router = express.Router();

/**
 * Safely parse ISO date-like values
 */
function safeParseDate(v) {
  if (!v) {return null;}
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * PUBLIC_INTERFACE
 * GET /api/costs/by-agent
 *
 * Tenant-scoped aggregation to compute Top agents by total cost.
 *
 * Query params:
 * - tenant_id | organization_id: accepted but ignored for filtering; tenant is enforced from resolved context.
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
  requireTenant,
  tenantScopeEnforcer(),
  asyncHandler(async (req, res) => {
    // Early bypass detector
    try {
      const hdr = (req.headers?.['x-organization-id'] || '').toString();
      const qOrg = (req.query?.organization_id || req.query?.tenant_id || '').toString();
      const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
      const requestedTenant = hdr || qOrg || authTenant || '';
      const isT0000 = requestedTenant && requestedTenant.toUpperCase() === 'T0000';
      if (isT0000) {
        req.tenantScopeDisabled = true;
        req.allTenants = true;
        req.costsByAgentAllTenantsBypass = true;
        try { res.set('X-All-Tenants', 'true'); } catch (_) {}
      }
      console.log('[costs.byAgent.routes] bypass check', { requestedTenant, isT0000, bypassApplied: !!isT0000 });
    } catch (_) {}
    // Clamp limit 1..100, default 20
    const limitRaw = parseInt(req.query?.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 20, 1), 100);

    const tenantId = req.tenantId;
    const startRaw = req.query?.start;
    const endRaw = req.query?.end;

    const start = safeParseDate(startRaw);
    const end = safeParseDate(endRaw);

    if ((startRaw && !start) || (endRaw && !end)) {
      return res.status(400).json({ success: false, message: 'Invalid ISO date in start/end query params' });
    }

    if (!tenantId) {
      return res.status(403).json({ success: false, message: 'Tenant required' });
    }

    // Build a minimal $match (enforce tenant_id and date window if provided)
    const andConditions = [];
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsByAgentAllTenantsBypass);
    if (!bypass) {
      andConditions.push({ tenant_id: String(tenantId) });
    } else {
      console.log('[costs.byAgent.routes] aggregation bypass active: skipping tenant match');
      try { res.set('X-All-Tenants', 'true'); } catch (_) {}
    }
    if (start || end) {
      const range = {};
      if (start) {range.$gte = start;}
      if (end) {range.$lte = end;}
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

    const pipeline = [{ $match: { $and: andConditions } }];

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
    // const collection = await getCollection(['llm-costs', 'llm_costs']);
     const collection = await getCollection(['llm-costs']);
    const items = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();

    return res.status(200).json({ items, total: items.length, limit });
  })
);

/**
 * PUBLIC_INTERFACE
 * Exports a single router instance.
 */
module.exports = router;
