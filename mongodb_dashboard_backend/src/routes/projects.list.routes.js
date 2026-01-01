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
 * Internal: parse JSON filter param.
 * Strips any tenant-scoping keys; tenant scoping is enforced server-side.
 */
function parseFilter(filterRaw) {
  if (!filterRaw) return {};
  if (typeof filterRaw === 'object') {
    // If already object-ish, clone defensively
    const f = Array.isArray(filterRaw) ? {} : { ...filterRaw };
    delete f.tenant_id;
    delete f.tenantId;
    delete f.organization_id;
    delete f.organizationId;
    delete f.orgId;
    return f;
  }

  if (typeof filterRaw !== 'string') return {};
  try {
    const f = JSON.parse(filterRaw);
    if (!f || typeof f !== 'object' || Array.isArray(f)) return {};
    delete f.tenant_id;
    delete f.tenantId;
    delete f.organization_id;
    delete f.organizationId;
    delete f.orgId;
    return f;
  } catch {
    // caller decides 400; return a sentinel
    return null;
  }
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

    return res.status(200).json({
      success: true,
      data: Array.isArray(items) ? items : [],
      meta: { total: Number(total || 0), page, limit },
    });
  })
);

module.exports = router;
