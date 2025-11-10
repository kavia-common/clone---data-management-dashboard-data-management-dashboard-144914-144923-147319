'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const User = require('../models/user.model');
const SessionTracking = require('../models/sessionTracking.model');
const Tenant = require('../models/tenant.model');
const mongoose = require('mongoose');
const { extractOrganization } = require('../middleware/extractOrganization');

const router = express.Router();
const controller = buildCrudController(User, '-created_at');

// Tenant summary cache (5 minutes)
const TENANT_SUMMARY_CACHE = new Map();
const TENANT_SUMMARY_TTL_MS = 5 * 60 * 1000;

function buildTenantSummaryCacheKey(q) {
  const key = {
    from: q.from || null,
    to: q.to || null,
    status: q.status || 'completed|active',
    includeInactive: String(q.includeInactive || 'false') === 'true',
    tenant_id: q.tenant_id || null,
  };
  return `tenant-summary:${JSON.stringify(key)}`;
}
function getCache(key) {
  const val = TENANT_SUMMARY_CACHE.get(key);
  if (!val) return null;
  if (Date.now() > val.expiresAt) {
    TENANT_SUMMARY_CACHE.delete(key);
    return null;
  }
  return val.value;
}
function setCache(key, value) {
  TENANT_SUMMARY_CACHE.set(key, { value, expiresAt: Date.now() + TENANT_SUMMARY_TTL_MS });
}

/**
 * GET /api/users/tenant-summary
 * Returns aggregated distinct active users grouped by tenant_id
 */
router.get(
  '/tenant-summary',
  extractOrganization(),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query || {};
    const includeInactive = String(req.query.includeInactive || 'false') === 'true';
    const statusParam = (req.query.status || 'completed|active').trim();

    const cacheKey = buildTenantSummaryCacheKey({
      from,
      to,
      status: statusParam,
      includeInactive,
      tenant_id: req.organization_id,
    });
    // Debug: request snapshot can be verbose; avoid logging entire req in production
    // console.log('REQ', JSON.stringify({ headers: req.headers, query: req.query, path: req.path }));
    const cached = getCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    // Parse date filters
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (from && Number.isNaN(fromDate?.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "from" date' });
    }
    if (to && Number.isNaN(toDate?.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "to" date' });
    }

    // Status filter
    const match = {};
    if (statusParam.includes('|')) {
      match.status = { $in: statusParam.split('|').map((s) => s.trim()).filter(Boolean) };
    } else {
      match.status = statusParam;
    }

    // ✅ Strictly restrict to tenant (organization) — across all possible ID fields
    const orgMatch = {
      $or: [
        { tenant_id: req.organization_id },
        { organization_id: req.organization_id },
        { organization_id: req.organization_id },
      ],
    };

    // Add date filters
    const timeClauses = [];
    if (fromDate || toDate) {
      const makeRange = (field) => {
        const range = {};
        if (fromDate) range.$gte = fromDate;
        if (toDate) range.$lte = toDate;
        return { [field]: range };
      };
      timeClauses.push(makeRange('timestamp'));
      timeClauses.push(makeRange('session_start'));
      timeClauses.push(makeRange('last_updated'));
    }

    // Combine match filters
    const matchStage =
      timeClauses.length > 0
        ? { $match: { ...match, ...orgMatch, $or: timeClauses } }
        : { $match: { ...match, ...orgMatch } };

    // Aggregation: count distinct users per tenant
    const pipeline = [
      matchStage,
      {
        $addFields: {
          _tenant_key: {
            $ifNull: [
              '$organization_id',
              { $ifNull: ['$tenant_id', '$organization_id'] },
            ],
          },
        },
      },
      {
        $match: {
          _tenant_key: { $eq: String(req.organization_id) },
        },
      },
      {
        $group: {
          _id: {
            tenant_id: '$_tenant_key',
            user_id: { $toString: '$user_id' },
          },
          last_activity: {
            $max: {
              $ifNull: [
                '$last_updated',
                { $ifNull: ['$session_end', { $ifNull: ['$timestamp', '$session_start'] }] },
              ],
            },
          },
        },
      },
      {
        $group: {
          _id: '$_id.tenant_id',
          user_count: { $sum: 1 },
          last_activity: { $max: '$last_activity' },
        },
      },
      {
        $project: {
          _id: 0,
          tenant_id: '$_id',
          user_count: 1,
          last_activity: 1,
        },
      },
      { $sort: { user_count: -1 } },
    ];

    let items = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

    // Enrich with tenant names
    const tenantIds = items.map((i) => i.tenant_id);
    const tenants = await Tenant.find({ tenant_id: { $in: tenantIds } }, { tenant_id: 1, tenant_name: 1 }).lean();
    const tenantMap = tenants.reduce((acc, t) => {
      acc[t.tenant_id] = t.tenant_name || null;
      return acc;
    }, {});

    items = items.map((i) => ({
      tenant_id: i.tenant_id,
      tenant_name: tenantMap[i.tenant_id] || null,
      user_count: i.user_count || 0,
      last_activity: i.last_activity ? new Date(i.last_activity).toISOString() : null,
    }));

    // Include inactive tenants if requested
    if (includeInactive) {
      const allTenants = await Tenant.find({}, { tenant_id: 1, tenant_name: 1, users: 1 }).lean();
      const existingIds = new Set(items.map((x) => x.tenant_id));
      for (const t of allTenants) {
        if (!existingIds.has(t.tenant_id)) {
          const fallbackCount = Array.isArray(t.users)
            ? new Set(t.users.map((u) => String(u.user_id))).size
            : 0;
          items.push({
            tenant_id: t.tenant_id,
            tenant_name: t.tenant_name || null,
            user_count: fallbackCount,
            last_activity: null,
          });
        }
      }
      items.sort((a, b) => b.user_count - a.user_count || a.tenant_id.localeCompare(b.tenant_id));
    }

    const response = { items, total: items.length };
    setCache(cacheKey, response);
    return res.status(200).json(response);
  })
);

module.exports = router;
