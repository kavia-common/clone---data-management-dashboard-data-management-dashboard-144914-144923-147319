'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler, failure } = require('../utils/http');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { extractOrganization } = require('../middleware/extractOrganization');
const Project = require('../models/project.model');

const router = express.Router();

/**
 * Internal: clamp integer query params.
 */
function clampInt(value, { min = 1, max = 200, fallback = 20 } = {}) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

/**
 * Internal: validate and normalize sort string.
 * Supports: "field" or "-field".
 */
function normalizeSort(sortRaw) {
  const allowed = new Set([
    '_id',
    'created_at',
    'updated_at',
    'project_id',
    'project_name',
    'status',
    'tenant_id',
    'owner_user_id',
  ]);

  const fallback = '-created_at';
  if (!sortRaw || typeof sortRaw !== 'string') return fallback;

  const trimmed = sortRaw.trim();
  const desc = trimmed.startsWith('-');
  const field = desc ? trimmed.slice(1) : trimmed;

  if (!allowed.has(field)) return fallback;
  return desc ? `-${field}` : field;
}

/**
 * Internal: attempt to parse a JSON-ish string. Supports double-encoded JSON.
 * Returns:
 *  - object on success
 *  - {} for falsy/empty
 *  - null for invalid input
 */
function parseJsonObjectish(input) {
  if (!input) return {};
  if (typeof input === 'object') {
    if (Array.isArray(input)) return {};
    return input;
  }
  if (typeof input !== 'string') return {};
  const s = input.trim();
  if (!s) return {};
  // Guard: reject mongo shell literals like ISODate("...") early (not valid JSON)
  if (/ISODate\s*\(/i.test(s)) return null;

  try {
    const first = JSON.parse(s);
    if (typeof first === 'string') {
      // Sometimes query param arrives as JSON-stringified JSON string.
      // Example: filter="{"status":"active"}"  (quotes included)
      try {
        const second = JSON.parse(first);
        if (!second || typeof second !== 'object' || Array.isArray(second)) return {};
        return second;
      } catch {
        return null;
      }
    }
    if (!first || typeof first !== 'object' || Array.isArray(first)) return {};
    return first;
  } catch {
    return null;
  }
}

/**
 * Internal: convert common Mongo Extended JSON date forms into JS Date objects.
 * Supports:
 *  - { "$date": "2025-01-01T00:00:00.000Z" }
 *  - { "$date": 1735689600000 } (ms since epoch)
 *
 * This avoids Mongoose CastErrors when filters are produced by tooling or copied from Mongo exports.
 */
function normalizeExtendedJsonDates(value) {
  if (!value) return value;

  if (Array.isArray(value)) {
    return value.map((v) => normalizeExtendedJsonDates(v));
  }

  if (typeof value !== 'object') return value;

  // Handle {$date: ...}
  if (
    Object.prototype.hasOwnProperty.call(value, '$date') &&
    Object.keys(value).length === 1
  ) {
    const raw = value.$date;
    const d =
      typeof raw === 'number'
        ? new Date(raw)
        : typeof raw === 'string'
          ? new Date(raw)
          : null;

    // If invalid date, keep original (will be rejected downstream if used against Date fields),
    // but we prefer to avoid throwing.
    if (d && !Number.isNaN(d.getTime())) return d;
    return value;
  }

  // Recurse normal objects
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = normalizeExtendedJsonDates(v);
  }
  return out;
}

/**
 * Internal: remove tenant scoping keys from a filter object.
 */
function stripTenantKeys(filterObj) {
  const f = filterObj && typeof filterObj === 'object' && !Array.isArray(filterObj) ? { ...filterObj } : {};
  delete f.tenant_id;
  delete f.tenantId;
  delete f.organization_id;
  delete f.organizationId;
  delete f.orgId;
  return f;
}

/**
 * Internal: parse JSON filter param.
 * Strips any tenant-scoping keys; tenant scoping is enforced server-side.
 * Also normalizes common date encodings.
 */
function parseFilter(filterRaw) {
  const parsed = parseJsonObjectish(filterRaw);
  if (parsed === null) return null;
  const stripped = stripTenantKeys(parsed);
  return normalizeExtendedJsonDates(stripped);
}

/**
 * Internal: build a normalized tenant OR filter to match historical schemas.
 */
function buildTenantOrFilter(tenantId) {
  const t = String(tenantId);
  return {
    $or: [
      { tenant_id: t },
      { organization_id: t },
      { orgId: t },
      { tenantId: t },
      { organizationId: t },
      { 'tenant.tenant_id': t },
    ],
  };
}

/**
 * Internal: build a simple case-insensitive "q" search across a few fields.
 * This intentionally avoids text indexes requirements and keeps it predictable.
 */
function buildQFilter(q) {
  const qq = String(q || '').trim();
  if (!qq) return null;
  // Basic escape to avoid regex DoS from pathological patterns
  const escaped = qq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(escaped, 'i');
  return {
    $or: [{ project_id: rx }, { project_name: rx }, { description: rx }, { status: rx }, { tenant_id: rx }],
  };
}

/**
 * PUBLIC_INTERFACE
 * GET /api/projects
 *
 * Summary:
 *  Paginated projects list with server-side filtering/search/sorting.
 *
 * Query params:
 *  - page (default 1)
 *  - limit (default 20, max 200)
 *  - sort (e.g. "-created_at", "project_name")
 *  - filter (JSON string)
 *  - q (case-insensitive search across project_id, project_name, description, status, tenant_id)
 *
 * Response:
 *  200 OK
 *  { success: true, data: [...], meta: { total, page, limit } }
 */
router.get(
  '/',
  // For list endpoints we allow both JWT and demo header/query scoping.
  // verifyAuth will populate req.auth when present; requireTenant enforces tenant via JWT or header/query.
  verifyAuth,
  requireTenant,
  // Also support organization extraction for demo/non-JWT flows.
  extractOrganization(),
  asyncHandler(async (req, res) => {
    // Pagination
    const page = clampInt(req.query?.page, { min: 1, max: 10_000, fallback: 1 });
    const limit = clampInt(req.query?.limit, { min: 1, max: 200, fallback: 20 });
    const skip = (page - 1) * limit;

    // Sort
    const sortStr = normalizeSort(req.query?.sort);
    const sortStage = sortStr.startsWith('-')
      ? { [sortStr.slice(1)]: -1 }
      : { [sortStr]: 1 };

    // Filter
    const filterParsed = parseFilter(req.query?.filter);
    if (filterParsed === null) {
      return failure(res, 'Invalid filter JSON', 400);
    }

    // Tenant scoping: enforced from req.tenantId unless bypass is active
    const bypass = !!(req.tenantScopeDisabled || req.allTenants);
    const tenantId = req.tenantId || req.organizationId;

    if (!bypass && !tenantId) {
      return failure(res, 'Missing tenant scope', 400);
    }

    // Build match
    const and = [];

    if (!bypass) and.push(buildTenantOrFilter(tenantId));

    if (filterParsed && Object.keys(filterParsed).length) and.push(filterParsed);

    const qFilter = buildQFilter(req.query?.q);
    if (qFilter) and.push(qFilter);

    const match = and.length ? { $and: and } : {};

    // Diagnostics headers (helpful in debugging)
    try {
      res.set('x-projects-page', String(page));
      res.set('x-projects-limit', String(limit));
      res.set('x-projects-sort', JSON.stringify(sortStage));
      res.set('x-projects-filter', JSON.stringify(match));
      res.set('x-effective-tenant', bypass ? 'all-tenants' : String(tenantId));
      res.set('x-tenant-bypass', String(bypass));
    } catch {}

    // Use aggregation so we can:
    // - coerce _id to string for frontend stability
    // - keep response consistent
    const pipeline = [
      { $match: match },
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limit },
      {
        $addFields: {
          _id: { $toString: '$_id' },
        },
      },
    ];

    const [items, total] = await Promise.all([
      Project.aggregate(pipeline).allowDiskUse(true),
      Project.countDocuments(match),
    ]);

    // Ensure meta.total is always a finite integer for frontend pagination math.
    const totalSafe = Number.isFinite(Number(total)) ? Number(total) : 0;

    return res.status(200).json({
      success: true,
      data: Array.isArray(items) ? items : [],
      meta: { total: totalSafe, page, limit },
    });
  })
);

module.exports = router;
