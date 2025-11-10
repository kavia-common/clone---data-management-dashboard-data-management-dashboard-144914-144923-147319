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
 * Accepts query params:
 *  - from: ISO datetime (inclusive)
 *  - to: ISO datetime (inclusive)
 *  - status: pipe-delimited statuses, e.g., "active|completed"
 *  - includeInactive: boolean (default false)
 * 
 * Enforces organization scoping from req.organizationId (set by extractOrganization middleware).
 */
async function getUsersTenantSummary(req, res) {
  try {
    // --- Parse query params ---
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

    let statuses = null;
    if (typeof req.query.status === 'string' && req.query.status.trim()) {
      statuses = req.query.status
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    let includeInactive = false;
    if (typeof req.query.includeInactive === 'string') {
      includeInactive = ['true', '1', 'yes'].includes(req.query.includeInactive.toLowerCase());
    }

    // --- Build MongoDB match ---
    const match = {};
    const scopedTenant = req.organizationId || req.tenantId;
    if (scopedTenant) {
      match.$or = [
        { tenant_id: String(scopedTenant) },
        { organization_id: String(scopedTenant) },
        { 'tenant.tenant_id': String(scopedTenant) },
      ];
    }

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

    // --- Build aggregation pipeline ---
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
      { $match: { _tenant_key: { $nin: [null, ''] } } },
      ...(scopedTenant
        ? [{ $match: { _tenant_key: String(scopedTenant) } }]
        : []),
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
          tenant_name: { $ifNull: [{ $arrayElemAt: ['$tenant_doc.tenant_name', 0] }, null] },
          tenant_status: { $ifNull: [{ $arrayElemAt: ['$tenant_doc.status', 0] }, null] },
        },
      },
    ];

    if (!includeInactive) {
      pipeline.push({
        $match: {
          $or: [
            { tenant_status: { $eq: null } },
            { tenant_status: 'active' },
          ],
        },
      });
    }

    pipeline.push({ $sort: { user_count: -1, tenant_id: 1 } });

    const items = await User.aggregate(pipeline).allowDiskUse(true);

    return res.status(200).json({
      success: true,
      items,
      total: items.length,
    });
  } catch (err) {
    const message = err?.message || 'Request failed';
    if (err?.name === 'CastError' || /Cast to/i.test(message)) {
      return res.status(400).json({ success: false, message: 'Invalid value provided (tenant summary)', details: message });
    }
    if ((mongoose.connection || {}).readyState !== 1) {
      return res.status(503).json({ success: false, message: 'Service unavailable: database not connected' });
    }
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}

module.exports = {
  getUsersTenantSummary,
};
