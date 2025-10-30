'use strict';

const mongoose = require('mongoose');
const User = require('../models/user.model');
const Tenant = require('../models/tenant.model');
const { isValidISODate } = require('../utils/date');

/**
 * PUBLIC_INTERFACE
 * getUsersTenantSummary
 * Controller for GET /api/users/tenant-summary
 * 
 * Aggregates users grouped by tenant (organization) with optional date range and status filters.
 * - Accepts query params:
 *    - from: ISO datetime (inclusive) -> applies to created_at or updated_at (whichever exists)
 *    - to: ISO datetime (inclusive)
 *    - status: pipe-delimited statuses, e.g., "active|completed"
 *    - includeInactive: boolean; when false (default) filters out tenants with status !== 'active'
 * - Groups users by tenant identifier (organization_id or tenant_id). Tries to resolve tenant_name from tenants collection.
 * 
 * Response:
 *  200: { success: true, items: [ { tenant_id, tenant_name?, user_count } ], total }
 *  400: on invalid params
 *  500: on unexpected errors (503 if DB disconnected)
 */
async function getUsersTenantSummary(req, res) {
  try {
    // Parse dates safely
    let from = null;
    let to = null;
    if (typeof req.query.from === 'string' && req.query.from.trim()) {
      if (!isValidISODate(req.query.from)) {
        return res.status(400).json({ success: false, message: 'Invalid "from" date' });
      }
      from = new Date(req.query.from);
    }
    if (typeof req.query.to === 'string' && req.query.to.trim()) {
      if (!isValidISODate(req.query.to)) {
        return res.status(400).json({ success: false, message: 'Invalid "to" date' });
      }
      to = new Date(req.query.to);
    }

    // Parse pipe-delimited status list
    let statuses = null;
    const rawStatus = req.query.status;
    if (typeof rawStatus === 'string' && rawStatus.trim()) {
      statuses = rawStatus
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (statuses.length === 0) statuses = null;
    }

    // Parse includeInactive boolean
    let includeInactive = false;
    const rawIncludeInactive = req.query.includeInactive;
    if (typeof rawIncludeInactive === 'string') {
      const v = rawIncludeInactive.toLowerCase();
      includeInactive = v === 'true' || v === '1' || v === 'yes';
    } else if (typeof rawIncludeInactive === 'boolean') {
      includeInactive = rawIncludeInactive;
    }

    // Build match stage for users collection
    const match = {};
    // Date range: consider created_at or updated_at. Use $or to be permissive.
    if (from || to) {
      const dateRange = {};
      if (from) dateRange.$gte = from;
      if (to) dateRange.$lte = to;
      match.$or = [
        { created_at: dateRange },
        { updated_at: dateRange },
      ];
    }
    if (statuses) {
      match.status = { $in: statuses };
    }

    // Group by tenant/organization field
    // Prefer document-level organization_id; if not present, also consider tenant_id field (in case users documents have that).
    // Construct a computed tenant key that picks the first non-null of organization_id, tenant_id, tenant?.tenant_id.
    const pipeline = [
      { $match: match },
      {
        $addFields: {
          _tenant_key: {
            $ifNull: [
              '$organization_id',
              { $ifNull: ['$tenant_id', '$tenant.tenant_id'] },
            ],
          },
        },
      },
      {
        $match: {
          _tenant_key: { $ne: null, $ne: '' },
        },
      },
      {
        $group: {
          _id: '$_tenant_key',
          user_count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          tenant_id: '$_id',
          user_count: 1,
        },
      },
    ];

    // Enrich with tenant_name and optionally filter inactive tenants (based on Tenants.status)
    // Use $lookup to tenants collection by tenant_id
    pipeline.push(
      {
        $lookup: {
          from: Tenant.collection.name,
          localField: 'tenant_id',
          foreignField: 'tenant_id',
          as: 'tenant_doc',
        },
      },
      {
        $addFields: {
          tenant_name: {
            $let: {
              vars: { t: { $arrayElemAt: ['$tenant_doc', 0] } },
              in: { $ifNull: ['$$t.tenant_name', null] },
            },
          },
          tenant_status: {
            $let: {
              vars: { t: { $arrayElemAt: ['$tenant_doc', 0] } },
              in: { $ifNull: ['$$t.status', null] },
            },
          },
        },
      }
    );

    if (!includeInactive) {
      pipeline.push({
        $match: {
          $or: [
            { tenant_status: { $eq: null } }, // If tenant record missing, don't exclude
            { tenant_status: 'active' },
          ],
        },
      });
    }

    // Sort descending by user_count for chart-friendly order
    pipeline.push({ $sort: { user_count: -1, tenant_id: 1 } });

    const items = await User.aggregate(pipeline).allowDiskUse(true);

    return res.status(200).json({
      success: true,
      items,
      total: items.length,
    });
  } catch (err) {
    const message = err?.message || 'Request failed';
    // Validation/cast errors -> 400
    if (err?.name === 'CastError' || /Cast to/i.test(message)) {
      return res.status(400).json({ success: false, message: 'Invalid value provided (tenant summary)', details: message });
    }
    // DB disconnected -> 503
    const ready = (mongoose.connection || {}).readyState;
    if (ready !== 1) {
      return res.status(503).json({ success: false, message: 'Service unavailable: database not connected' });
    }
    // Unexpected -> 500
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}

module.exports = {
  getUsersTenantSummary,
};
