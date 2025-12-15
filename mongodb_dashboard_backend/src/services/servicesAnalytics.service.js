'use strict';

/**
 * Services Analytics service module.
 * Aggregates SessionTracking collection by service_type with tenant scoping and overview-style date filters.
 */

const mongoose = require('mongoose');
const SessionTracking = require('../models/sessionTracking.model');
const { parseOverviewRange } = require('../utils/date'); // we will implement a helper locally to avoid coupling
const { getOrganizationFromRequest } = require('../middleware/tenantContext'); // reuse existing helper if available

/**
 * INTERNAL: builds effective date window based on range and optional start/end (YYYY-MM-DD)
 */
function resolveDateWindow({ range = 'daily', start_date, end_date }) {
  const now = new Date();

  const toEndOfDay = (d) => {
    const dt = new Date(d);
    dt.setHours(23, 59, 59, 999);
    return dt;
    // eslint-disable-next-line
  };

  const toStartOfDay = (d) => {
    const dt = new Date(d);
    dt.setHours(0, 0, 0, 0);
    return dt;
  };

  if (range === 'custom') {
    if (!start_date || !end_date) {
      throw new Error('start_date and end_date are required when range=custom');
    }
    return {
      start: toStartOfDay(new Date(`${start_date}T00:00:00Z`)),
      end: toEndOfDay(new Date(`${end_date}T00:00:00Z`)),
      range: 'custom',
      start_date,
      end_date
    };
  }

  // defaults similar to other overview endpoints: last N buckets ending today
  const end = toEndOfDay(now);
  let start;
  switch (range) {
    case 'daily': {
      // last 7 days as default window
      const s = new Date(end);
      s.setDate(s.getDate() - 6);
      start = toStartOfDay(s);
      break;
    }
    case 'weekly': {
      // last 8 weeks (approx 8*7 days)
      const s = new Date(end);
      s.setDate(s.getDate() - 7 * 7);
      start = toStartOfDay(s);
      break;
    }
    case 'monthly': {
      // last 12 months
      const s = new Date(end);
      s.setMonth(s.getMonth() - 11);
      s.setDate(1);
      start = toStartOfDay(s);
      break;
    }
    default: {
      const s = new Date(end);
      s.setDate(s.getDate() - 6);
      start = toStartOfDay(s);
      range = 'daily';
    }
  }
  return {
    start,
    end,
    range
  };
}

/**
 * PUBLIC_INTERFACE
 * Get summary counts grouped by service_type from SessionTracking, with tenant scoping.
 * @param {object} opts
 * @param {string} opts.organizationId - tenant id (can be T0000 for super-admin)
 * @param {('daily'|'weekly'|'monthly'|'custom')} opts.range
 * @param {string=} opts.start_date - YYYY-MM-DD when range=custom
 * @param {string=} opts.end_date - YYYY-MM-DD when range=custom
 * @param {boolean=} opts.includeOrgBuckets - when org is super admin, group by tenant as orgBuckets
 * @returns {Promise<{range:string,start_date?:string,end_date?:string,items:Array,orgBuckets?:Array}>}
 */
async function getServiceTypesSummary({ organizationId, range = 'daily', start_date, end_date, includeOrgBuckets = false }) {
  const { start, end } = resolveDateWindow({ range, start_date, end_date });

  // Build filter
  const match = {
    // use session_start or created_at or last_updated; prefer created_at if present, fall back to session_start
    $and: [
      {
        $or: [
          { created_at: { $exists: true } },
          { session_start: { $exists: true } },
          { last_updated: { $exists: true } }
        ]
      },
      {
        $or: [
          { created_at: { $gte: start, $lte: end } },
          { session_start: { $gte: start, $lte: end } },
          { last_updated: { $gte: start, $lte: end } }
        ]
      }
    ]
  };

  const isSuperAdmin = organizationId === 'T0000';
  if (!isSuperAdmin) {
    match.tenant_id = organizationId;
  }

  // Aggregation: core group by service_type
  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: { service_type: '$service_type' },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        service_type: '$_id.service_type',
        count: 1
      }
    },
    { $sort: { count: -1 } }
  ];

  const items = await SessionTracking.aggregate(pipeline).allowDiskUse(true).exec();

  const response = {
    range,
    start_date: start_date || start.toISOString().slice(0, 10),
    end_date: end_date || end.toISOString().slice(0, 10),
    items
  };

  if (isSuperAdmin && includeOrgBuckets) {
    // Additional breakdown: by tenant and service_type
    const orgPipeline = [
      { $match: match },
      {
        $group: {
          _id: { tenant_id: '$tenant_id', service_type: '$service_type' },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.tenant_id',
          services: {
            $push: {
              service_type: '$_id.service_type',
              count: '$count'
            }
          },
          total: { $sum: '$count' }
        }
      },
      {
        $project: {
          _id: 0,
          tenant_id: '$_id',
          total: 1,
          services: 1
        }
      },
      { $sort: { total: -1 } }
    ];
    const orgBuckets = await SessionTracking.aggregate(orgPipeline).allowDiskUse(true).exec();
    response.orgBuckets = orgBuckets;
  }

  return response;
}

module.exports = {
  getServiceTypesSummary
};
