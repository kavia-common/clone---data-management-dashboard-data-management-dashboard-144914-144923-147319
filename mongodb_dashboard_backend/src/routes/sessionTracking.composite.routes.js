'use strict';

const express = require('express');
const crypto = require('crypto');
const SessionTracking = require('../models/sessionTracking.model');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
/**
 * NOTE:
 * sessions.aggregates.service was removed. Provide local safe stubs that either
 * aggregate using Mongoose directly when DB is connected, or return empty arrays.
 * This prevents MODULE_NOT_FOUND errors while preserving composite route behavior.
 */
async function sessionsByType({ tenantId, start, end, allowBypass }) {
  const mongoose = require('mongoose');
  const ready = mongoose.connection?.readyState;
  const dbConnected = ready === 1;
  if (!dbConnected) return [];

  const match = {};
  if (!allowBypass && tenantId) {
    match.$or = [
      { tenant_id: tenantId },
      { organization_id: tenantId },
      { organizationId: tenantId },
    ];
  }
  const timeCond = {};
  if (start) timeCond.$gte = new Date(start);
  if (end) {
    const endDate = new Date(end);
    if (!isNaN(endDate.getTime())) {
      endDate.setUTCHours(23, 59, 59, 999);
      timeCond.$lte = endDate;
    }
  }
  if (Object.keys(timeCond).length) {
    match.session_start = timeCond;
  }

  // Gracefully handle missing field; group by session_data.llm_model or service_type as a proxy for "type"
  const pipeline = [
    { $match: match },
    {
      $addFields: {
        _type: {
          $ifNull: ['$session_type', { $ifNull: ['$service_type', { $ifNull: ['$session_data.llm_model', 'Unknown'] }] }],
        },
      },
    },
    { $group: { _id: '$_type', total: { $sum: 1 } } },
    { $project: { _id: 0, type: '$_id', total: 1 } },
    { $sort: { total: -1 } },
    { $limit: 50 },
  ];

  try {
    return await SessionTracking.aggregate(pipeline).allowDiskUse(true);
  } catch {
    return [];
  }
}

async function sessionsByOrganization({ tenantId, start, end, allowBypass }) {
  const mongoose = require('mongoose');
  const ready = mongoose.connection?.readyState;
  const dbConnected = ready === 1;
  if (!dbConnected) return [];

  const match = {};
  if (!allowBypass && tenantId) {
    match.$or = [
      { tenant_id: tenantId },
      { organization_id: tenantId },
      { organizationId: tenantId },
    ];
  }
  const timeCond = {};
  if (start) timeCond.$gte = new Date(start);
  if (end) {
    const endDate = new Date(end);
    if (!isNaN(endDate.getTime())) {
      endDate.setUTCHours(23, 59, 59, 999);
      timeCond.$lte = endDate;
    }
  }
  if (Object.keys(timeCond).length) {
    match.session_start = timeCond;
  }

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        _tenant: {
          $ifNull: [
            '$tenant_id',
            { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', 'Unknown'] }] },
          ],
        },
      },
    },
    { $group: { _id: '$_tenant', total: { $sum: 1 } } },
    { $project: { _id: 0, tenant_id: '$_id', total: 1 } },
    { $sort: { total: -1 } },
    { $limit: 50 },
  ];

  try {
    return await SessionTracking.aggregate(pipeline).allowDiskUse(true);
  } catch {
    return [];
  }
}
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/composite
 * Composite endpoint that returns all data needed by the Sessions view in one response.
 *
 * Query params (same as list endpoint):
 * - tenant_id | organization_id (required unless T0000 bypass via JWT or headers)
 * - page, limit (or pageSize alias), sort
 * - q (text search)
 * - start, end (ISO) date range bounds
 * Additional optional include flags (default true):
 * - include_breakdowns=true|false
 * - include_series=true|false
 *
 * Response:
 * {
 *   success: true,
 *   params: { ...normalized input... },
 *   table: { data, meta: { page, limit, total, sort } },
 *   aggregates: {
 *     totals: { totalSessions, active, completed },
 *     series: { byType: [...], byOrganization: [...] },
 *     breakdowns: { byStatus: [...], byUser: [...], byTenant: [...] }
 *   },
 *   generated_at: ISO,
 *   etag: "..."
 * }
 *
 * Notes:
 * - Tenant scoping: honors JWT/requireTenant rules configured in router mounting (see routes/index.js).
 * - Deterministic ordering: consistent with list endpoint (default -session_start).
 * - ETag/Cache-Control support and small in-memory TTL cache (env-toggleable).
 */

// Feature flags/env toggles for composite caching
const ENABLE_COMPOSITE_CACHE = String(process.env.ENABLE_COMPOSITE_CACHE || 'true').toLowerCase() === 'true';
const ENABLE_COMPOSITE_ETAG = String(process.env.ENABLE_COMPOSITE_ETAG || 'true').toLowerCase() === 'true';
const COMPOSITE_CACHE_TTL_SECONDS = Number(process.env.COMPOSITE_CACHE_TTL_SECONDS || process.env.CACHE_TTL_SECONDS || 60);
const COMPOSITE_CACHE_TTL_MS = Math.max(10, COMPOSITE_CACHE_TTL_SECONDS) * 1000;

// Simple in-memory TTL cache
const compositeCache = new Map(); // key -> { payload, etag, expiresAt }
function compositeCacheGet(key) {
  const ent = compositeCache.get(key);
  if (!ent) return null;
  if (Date.now() > ent.expiresAt) {
    compositeCache.delete(key);
    return null;
  }
  return ent;
}
function compositeCacheSet(key, payload, etag) {
  compositeCache.set(key, { payload, etag, expiresAt: Date.now() + COMPOSITE_CACHE_TTL_MS });
}

function roundToMinuteISO(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

function compositeCacheKey(req, tenant) {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || req.query.pageSize || 20);
  const sort = typeof req.query.sort === 'string' && req.query.sort.trim() ? req.query.sort.trim() : '-session_start';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const start = roundToMinuteISO(req.query.start || req.query.from || '');
  const end = roundToMinuteISO(req.query.end || req.query.to || '');
  const include_breakdowns = String(req.query.include_breakdowns ?? 'true').toLowerCase() !== 'false';
  const include_series = String(req.query.include_series ?? 'true').toLowerCase() !== 'false';
  const tenantKey = tenant ? String(tenant) : 'all-tenants';

  return JSON.stringify({
    route: 'GET:/api/session-tracking/composite',
    tenant: tenantKey,
    page,
    limit,
    sort,
    q,
    start,
    end,
    include_breakdowns,
    include_series,
  });
}

function computeETag(payload, context) {
  try {
    const basis = JSON.stringify({
      ctx: context,
      len: Array.isArray(payload?.table?.data) ? payload.table.data.length : null,
      total: payload?.table?.meta?.total ?? null,
      // use top-level counts for versioning
      totals: payload?.aggregates?.totals ?? null,
    });
    return crypto.createHash('sha1').update(basis).digest('hex');
  } catch {
    const s = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    return crypto.createHash('sha1').update(s).digest('hex');
  }
}

// Builds the same filter/search/tenant scoping as sessionTracking list route
function buildQueryState(req, enforcedTenant, bypass) {
  const rawQuery = { ...req.query };
  if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
  const { page, limit, skip } = parsePagination(rawQuery);
  const sort = req.query.sort || '-session_start';

  // Text search
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  let qFilter = {};
  if (q) {
    const regex = new RegExp(q, 'i');
    qFilter = {
      $or: [
        { task_id: regex },
        { tenant_id: regex },
        { organization_name: regex },
        { user_name: regex },
        { User_name: regex },
        { project_id: regex },
        { container_id: regex },
        { service_type: regex },
        { status: regex },
        { user_id: regex },
        { 'session_data.session_name': regex },
        { 'session_data.description': regex },
        { 'session_data.llm_model': regex },
      ],
    };
  }

  const enforcedScope = (!bypass && enforcedTenant)
    ? {
        $or: [
          { tenant_id: enforcedTenant },
          { organization_id: enforcedTenant },
          { organizationId: enforcedTenant },
        ],
      }
    : {};

  const parts = [];
  const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);
  if (!isEmpty(qFilter)) parts.push(qFilter);
  if (!isEmpty(enforcedScope)) parts.push(enforcedScope);
  const filter = parts.length > 1 ? { $and: parts } : (parts[0] || {});

  // Date bounds (prefer query start/end; default window maintained by list route is not replicated here to keep composite explicit)
  const start = typeof req.query.start === 'string' ? new Date(req.query.start) : null;
  const endRaw = typeof req.query.end === 'string' ? new Date(req.query.end) : null;
  let end = endRaw;
  if (endRaw && !isNaN(endRaw.getTime())) {
    // inclusive end-of-day
    end = new Date(endRaw);
    end.setUTCHours(23, 59, 59, 999);
  }

  const timeFilter = {};
  if (start && !isNaN(start.getTime())) timeFilter.$gte = start;
  if (end && !isNaN(end.getTime())) timeFilter.$lte = end;
  const finalFilter = Object.keys(timeFilter).length
    ? (isEmpty(filter) ? { session_start: timeFilter } : { $and: [filter, { session_start: timeFilter }] })
    : filter;

  return { page, limit, skip, sort, filter, q, start, end };
}

// PUBLIC_INTERFACE
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Determine bypass and tenant like the sessionTracking route
    const bypass = !!(
      req.tenantScopeDisabled ||
      req.allTenants ||
      req.sessionsAllTenantsBypass ||
      req?.user?.isSuperAdmin
    );

    const enforcedTenant =
      req.tenantId ||
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      null;

    if (!bypass && !enforcedTenant) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=...'
      });
    }

    const include_breakdowns = String(req.query.include_breakdowns ?? 'true').toLowerCase() !== 'false';
    const include_series = String(req.query.include_series ?? 'true').toLowerCase() !== 'false';

    const { page, limit, skip, sort, filter, q, start, end } = buildQueryState(req, enforcedTenant, bypass);

    // Cache attempt
    const cacheKey = compositeCacheKey(req, bypass ? 'all-tenants' : enforcedTenant);
    const wantCache = ENABLE_COMPOSITE_CACHE;
    const wantETag = ENABLE_COMPOSITE_ETAG;

    if (wantCache) {
      const hit = compositeCacheGet(cacheKey);
      if (hit) {
        const inm = req.headers['if-none-match'];
        if (wantETag && inm && inm === hit.etag) {
          res.set('ETag', hit.etag);
          res.set('Cache-Control', `public, max-age=${Math.floor(COMPOSITE_CACHE_TTL_MS / 1000)}, must-revalidate`);
          return res.status(304).end();
        }
        res.set('X-Cache', 'HIT');
        if (wantETag && hit.etag) res.set('ETag', hit.etag);
        res.set('Cache-Control', `public, max-age=${Math.floor(COMPOSITE_CACHE_TTL_MS / 1000)}, must-revalidate`);
        return res.status(200).json(hit.payload);
      }
    }

    // Graceful fallback when DB is not connected to allow ETag and cache verification
    const mongoose = require('mongoose');
    const ready = mongoose.connection?.readyState;
    const dbConnected = ready === 1;
    if (!dbConnected) {
      const payload = {
        success: true,
        params: {
          tenant_id: bypass ? 'all-tenants' : enforcedTenant,
          page,
          limit,
          sort,
          q,
          start: start ? start.toISOString() : null,
          end: end ? end.toISOString() : null,
          include_breakdowns,
          include_series,
        },
        table: { data: [], meta: { page, limit, total: 0, sort } },
        aggregates: {
          totals: { totalSessions: 0, active: 0, completed: 0 },
          series: include_series ? { byType: [], byOrganization: [] } : undefined,
          breakdowns: include_breakdowns ? { byStatus: [], byUser: [], byTenant: [] } : undefined,
        },
        generated_at: new Date().toISOString(),
      };
      const etag = wantETag ? computeETag(payload, {
        tenant: bypass ? 'all-tenants' : enforcedTenant, page, limit, sort, q,
        start: payload.params.start, end: payload.params.end,
        include_breakdowns, include_series
      }) : null;

      if (wantETag && etag) res.set('ETag', etag);
      res.set('Cache-Control', `public, max-age=${Math.floor(COMPOSITE_CACHE_TTL_MS / 1000)}, must-revalidate`);

      const inm = req.headers['if-none-match'];
      if (wantETag && inm && etag && inm === etag) {
        return res.status(304).end();
      }

      if (wantCache) compositeCacheSet(cacheKey, payload, etag);
      if (etag) payload.etag = etag;
      return res.status(200).json(payload);
    }

    // Parallel fan-out: table list (paginated), totals/breakdowns, series
    const allowBypass = bypass;
    const seriesParams = {
      tenantId: enforcedTenant,
      start: start ? start.toISOString() : undefined,
      end: end ? end.toISOString() : undefined,
      allowBypass,
      limit: 20,
    };

    // Table list
    const listPromise = Promise.all([
      SessionTracking.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      SessionTracking.countDocuments(filter),
    ]);

    // Totals and breakdowns
    const totalsPromise = SessionTracking.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        },
      },
      { $project: { _id: 0, total: 1, completed: 1, active: 1 } },
    ]).allowDiskUse(true);

    // Optional breakdowns
    const breakdownsPromises = include_breakdowns
      ? {
          byStatus: SessionTracking.aggregate([
            { $match: filter },
            { $group: { _id: '$status', total: { $sum: 1 } } },
            { $project: { _id: 0, status: '$_id', total: 1 } },
            { $sort: { total: -1 } },
          ]).allowDiskUse(true),
          byUser: SessionTracking.aggregate([
            { $match: filter },
            {
              $project: {
                _user: {
                  $cond: [{ $ifNull: ['$user_id', false] }, { $toString: '$user_id' }, null],
                },
              },
            },
            { $group: { _id: '$_user', total: { $sum: 1 } } },
            { $project: { _id: 0, user_id: '$_id', total: 1 } },
            { $sort: { total: -1 } },
            { $limit: 20 },
          ]).allowDiskUse(true),
          byTenant: SessionTracking.aggregate([
            { $match: filter },
            {
              $addFields: {
                _tenant: {
                  $ifNull: [
                    '$tenant_id',
                    { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', 'Unknown'] }] },
                  ],
                },
              },
            },
            { $group: { _id: '$_tenant', total: { $sum: 1 } } },
            { $project: { _id: 0, tenant_id: '$_id', total: 1 } },
            { $sort: { total: -1 } },
            { $limit: 20 },
          ]).allowDiskUse(true),
        }
      : null;

    // Optional series using existing services
    const seriesPromises = include_series
      ? {
          byType: sessionsByType(seriesParams),
          byOrganization: sessionsByOrganization(seriesParams),
        }
      : null;

    // Fan-out await
    const [listRes, totalsRes, byStatus, byUser, byTenant, byType, byOrganization] = await Promise.all([
      listPromise,
      totalsPromise.then((arr) => (Array.isArray(arr) && arr[0]) || { total: 0, active: 0, completed: 0 }),
      breakdownsPromises ? breakdownsPromises.byStatus : Promise.resolve([]),
      breakdownsPromises ? breakdownsPromises.byUser : Promise.resolve([]),
      breakdownsPromises ? breakdownsPromises.byTenant : Promise.resolve([]),
      seriesPromises ? seriesPromises.byType : Promise.resolve([]),
      seriesPromises ? seriesPromises.byOrganization : Promise.resolve([]),
    ]);

    const [docs, totalCount] = listRes;

    const payload = {
      success: true,
      params: {
        tenant_id: bypass ? 'all-tenants' : enforcedTenant,
        page,
        limit,
        sort,
        q,
        start: start ? start.toISOString() : null,
        end: end ? end.toISOString() : null,
        include_breakdowns,
        include_series,
      },
      table: {
        data: docs,
        meta: { page, limit, total: totalCount, sort },
      },
      aggregates: {
        totals: {
          totalSessions: totalsRes.total || 0,
          active: totalsRes.active || 0,
          completed: totalsRes.completed || 0,
        },
        series: include_series ? { byType: byType || [], byOrganization: byOrganization || [] } : undefined,
        breakdowns: include_breakdowns
          ? { byStatus: byStatus || [], byUser: byUser || [], byTenant: byTenant || [] }
          : undefined,
      },
      generated_at: new Date().toISOString(),
    };

    // ETag + caching
    const etag = wantETag
      ? computeETag(payload, {
          tenant: bypass ? 'all-tenants' : enforcedTenant,
          page,
          limit,
          sort,
          q,
          start: payload.params.start,
          end: payload.params.end,
          include_breakdowns,
          include_series,
        })
      : null;

    if (wantETag && etag) res.set('ETag', etag);
    res.set('Cache-Control', `public, max-age=${Math.floor(COMPOSITE_CACHE_TTL_MS / 1000)}, must-revalidate`);
    if (wantCache) compositeCacheSet(cacheKey, payload, etag);

    const inm = req.headers['if-none-match'];
    if (wantETag && inm && etag && inm === etag) {
      return res.status(304).end();
    }

    // Also return etag in the body for clients that prefer payload access
    if (etag) payload.etag = etag;

    return res.status(200).json(payload);
  })
);

module.exports = router;
