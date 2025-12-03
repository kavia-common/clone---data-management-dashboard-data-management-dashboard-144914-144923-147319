'use strict';

const LLMCost = require('../models/llmCosts.model');
const User = require('../models/user.model'); // used only for collection name and clarity
const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * list
 * Handler: GET /api/llm-costs
 *
 * PERFORMANCE & SAFETY NOTES
 * - Never project users: 1 or user: 1 on llm-costs. Some deployments embed very large user sub-documents. Projecting them
 *   forces MongoDB to load/serialize big blobs and can trigger timeouts. Default behavior excludes any embedded users.
 * - Optional include_users=min (or include_user=min) provides only minimal user fields efficiently via $lookup on users collection
 *   or via minified projection of embedded array when no users collection is available.
 * - Pagination is clamped (default=10, max=200). Aggregate maxTimeMS ~1000–1500ms with a route-level timeout guard returning 206.
 */
async function list(req, res) {
  try {
    // Disable caches; remove validators that might cause client revalidation
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      if (typeof res.removeHeader === 'function') {
        res.removeHeader('ETag');
        res.removeHeader('Last-Modified');
      }
    } catch (_) {}

    // Pagination clamp
    const defaultLimit = 10;
    const maxLimit = 200;
    const pageRaw = parseInt(req.query?.page, 10);
    const limitRaw = parseInt(req.query?.limit, 10);
    const usingExplicitPagination = Number.isFinite(pageRaw) || Number.isFinite(limitRaw);
    const page = Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1);
    let limit = Number.isFinite(limitRaw) ? limitRaw : defaultLimit;
    if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
    if (limit > maxLimit) limit = maxLimit;

    const sort = (req.query?.sort && typeof req.query.sort === 'string') ? req.query.sort : '-timestamp';

    // Deterministic tenant resolution (no broad $or here). If organization_id provided, prefer it.
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass);
    let resolvedTenant = null;
    if (!bypass) {
      // precedence: header x-organization-id -> query organization_id -> header/query tenant aliases -> JWT
      const hdrOrg = (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) || '';
      const qOrg = (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) || '';
      const hdrTenant = (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
                        (typeof req.headers?.['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) || '';
      const qTenant = (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
                      (typeof req.query?.tenantId === 'string' && req.query.tenantId.trim()) || '';
      resolvedTenant = hdrOrg || qOrg || hdrTenant || qTenant || (req.auth?.tenantId ? String(req.auth.tenantId) : '') || '';
      resolvedTenant = resolvedTenant || req.tenantId || '';
      if (!resolvedTenant) {
        return res.status(400).json({ success: false, message: 'Missing tenant scope' });
      }
    }

    // Tenant filter: prefer organization_id mapping if present in this collection; otherwise fallback to tenant_id
    let filter = {};
    if (!bypass) {
      const t = String(resolvedTenant);
      try {
        const probe = await LLMCost.exists({ organization_id: t }).maxTimeMS(200);
        filter = probe ? { organization_id: t } : { tenant_id: t };
      } catch (_) {
        filter = { tenant_id: t };
      }
    }

    // Merge client filter except tenant keys
    try {
      if (req.query?.filter) {
        const userFilter = JSON.parse(req.query.filter);
        delete userFilter.tenant_id;
        delete userFilter.tenantId;
        delete userFilter.organization_id;
        delete userFilter.organizationId;
        delete userFilter.orgId;
        if (Object.keys(userFilter).length) {
          filter = Object.keys(filter).length ? { $and: [filter, userFilter] } : userFilter;
        }
      }
    } catch (e) {
      try { res.set('X-Filter-Parse-Error', String(e?.message || e)); } catch(_) {}
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }

    // Include users mode detection. Support include_user=min and include_users=min. Any other value is ignored.
    const includeFlag = (req.query?.include_user || req.query?.include_users || '').toString().trim().toLowerCase();
    const includeUserMin = includeFlag === 'min';

    // Base projection (NEVER include users/users[] directly; keep base small)
    const baseProject = {
      _id: 1,
      tenant_id: 1,
      organization_id: 1,
      user_id: 1, // reference only
      project_id: 1,
      agent: 1,
      agent_name: 1,
      total_cost: 1,
      cost_usd: 1,
      'cost.amount': 1,
      'cost.currency': 1,
      timestamp: 1,
      created_at: 1,
      // NO users/users[] here. If embedded users exist, they will be excluded by default.
    };

    const guardLimit = usingExplicitPagination ? limit : Math.min(50, maxLimit);
    const skip = usingExplicitPagination ? (page - 1) * limit : 0;

    // Clamp aggregate time
    const maxTimeMS = Math.max(200, Math.min(Number(req.maxTimeMS || 1000), 1500));

    // Header diagnostics (non-fatal)
    try {
      res.set('X-Applied-Tenant', String(bypass ? 'all-tenants' : (resolvedTenant || '')));
      res.set('X-Include-Users', includeUserMin ? 'min' : 'none');
      res.set('Cache-Control', 'no-store');
    } catch (_) {}

    // Default path: no users join/minification requested. Simple lean find with baseProject
    if (!includeUserMin) {
      const query = LLMCost.find(filter, baseProject)
        .sort(sort)
        .skip(skip)
        .limit(guardLimit)
        .maxTimeMS(maxTimeMS)
        .lean({ getters: false, virtuals: false });

      if (usingExplicitPagination) {
        const [items, total] = await Promise.all([
          query.exec(),
          LLMCost.countDocuments(filter).maxTimeMS(maxTimeMS).exec(),
        ]);
        const trimmed = (items || []).map(trimHeavyFields);
        return res.status(200).json({ success: true, data: trimmed, meta: { page, limit, total } });
      }
      const items = await query.exec();
      const trimmed = (items || []).map(trimHeavyFields);
      return res.status(200).json(trimmed);
    }

    // include_users=min: efficient strategy
    // If a users collection exists, use $lookup to fetch minimal fields.
    const usersColl = User?.collection?.name || 'users';

    const mongoSort = parseSort(sort);

    // Start pipeline with $match and early $project to keep docs small
    const pipeline = [];
    if (filter && Object.keys(filter).length) {
      pipeline.push({ $match: filter });
    }
    pipeline.push({
      $project: {
        ...baseProject,
        // Prepare normalized join keys (if user_id/email present in cost docs)
        _join_user_id: { $toString: { $ifNull: ['$user_id', ''] } },
        _join_email: { $toLower: { $toString: { $ifNull: ['$email', ''] } } },
        // If users are embedded (users array), do not include them; we will conditionally create users_min later if no users collection is available.
      },
    });

    // Sort then window before lookup to limit join set size
    if (mongoSort && Object.keys(mongoSort).length) pipeline.push({ $sort: mongoSort });
    if (skip > 0) pipeline.push({ $skip: skip });
    pipeline.push({ $limit: guardLimit });

    // Lookup minimal user details from users collection (whitelist fields only)
    pipeline.push({
      $lookup: {
        from: usersColl,
        let: { uid: '$_join_user_id', uemail: '$_join_email', org: '$organization_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  {
                    $or: [
                      { $and: [{ $ne: ['$$uid', ''] }, { $eq: [{ $toString: '$user_id' }, '$$uid'] }] },
                      { $and: [{ $ne: ['$$uemail', ''] }, { $eq: [{ $toLower: { $ifNull: ['$email', ''] } }, '$$uemail'] }] },
                    ],
                  },
                  // tenant match guard to avoid cross-tenant collisions when possible
                  {
                    $or: [
                      { $not: [{ $gt: [{ $strLenCP: { $toString: '$$org' } }, 0] }] },
                      { $eq: [{ $toString: '$organization_id' }, { $toString: '$$org' }] },
                    ],
                  },
                ],
              },
            },
          },
          {
            $project: {
              _id: 1,
              user_id: 1,
              email: 1,
              displayName: 1,
              display_name: 1,
              name: 1,
              full_name: 1,
              fullName: 1,
            },
          },
          { $limit: 1 },
        ],
        as: '_user_min_arr',
      },
    });

    // users_min flattened
    pipeline.push({
      $addFields: {
        users_min: {
          $let: {
            vars: { u: { $first: '$_user_min_arr' } },
            in: [
              {
                _id: '$$u._id',
                user_id: '$$u.user_id',
                email: '$$u.email',
                displayName: {
                  $ifNull: [
                    '$$u.displayName',
                    { $ifNull: ['$$u.display_name', { $ifNull: ['$$u.fullName', { $ifNull: ['$$u.full_name', '$$u.name'] }] }] },
                  ],
                },
              },
            ],
          },
        },
      },
    });

    // Final project: strip helpers; also ensure no embedded users array leaks
    pipeline.push({
      $project: {
        _user_min_arr: 0,
        _join_user_id: 0,
        _join_email: 0,
        users: 0,
        user: 0,
      },
    });

    // Execute with time cap
    let items = [];
    try {
      items = await LLMCost.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS }).exec();
    } catch (aggErr) {
      // If users collection is missing or lookup fails AND there is an embedded users array, fallback to embedded minification
      const msg = String(aggErr?.message || aggErr || '');
      const isLookupFailure = /failed|namespace|not found|does not exist|Lookup/gi.test(msg);
      if (!isLookupFailure) throw aggErr;

      // Fallback: embedded users minification projection (users_min from users array). Never include full users.
      const fallbackPipeline = [];
      if (filter && Object.keys(filter).length) fallbackPipeline.push({ $match: filter });
      if (mongoSort && Object.keys(mongoSort).length) fallbackPipeline.push({ $sort: mongoSort });
      if (skip > 0) fallbackPipeline.push({ $skip: skip });
      fallbackPipeline.push({ $limit: guardLimit });
      fallbackPipeline.push({
        $project: {
          ...baseProject,
          users_min: {
            $map: {
              input: { $ifNull: ['$users', []] },
              as: 'u',
              in: {
                id: '$$u.id',
                displayName: '$$u.displayName',
                email: '$$u.email',
              },
            },
          },
          users: 0,
          user: 0,
        },
      });
      items = await LLMCost.aggregate(fallbackPipeline).option({ allowDiskUse: true, maxTimeMS }).exec();
    }

    const trimmed = (items || []).map(trimHeavyFields);

    if (usingExplicitPagination) {
      const total = await LLMCost.countDocuments(filter).maxTimeMS(maxTimeMS).exec();
      return res.status(200).json({ success: true, data: trimmed, meta: { page, limit, total } });
    }
    return res.status(200).json(trimmed);
  } catch (err) {
    const msg = String(err?.message || err);
    const isMongoTimeout = /operation exceeded time limit|timed out|MaxTimeMS/i.test(msg);
    const isSelectionTimeout = /server selection error|server selection timed out|ENOTFOUND|ECONNREFUSED/i.test(msg);
    try { res.set('X-Mongo-Error', msg); } catch(_) {}
    const status = isMongoTimeout || isSelectionTimeout ? 206 : 500;
    return res.status(status).json({
      success: false,
      message: isMongoTimeout ? 'Query exceeded time limit' : isSelectionTimeout ? 'Database selection timeout' : 'Internal server error',
      data: [],
      meta: {
        timedOut: isMongoTimeout || isSelectionTimeout,
        maxTimeMS: Math.max(200, Math.min(Number(req.maxTimeMS || 1000), 1500)),
        partial: true,
      },
    });
  }
}

/**
 * Convert sort string like "-timestamp,name" into Mongo sort document.
 * Falls back to { timestamp: -1, _id: 1 } when invalid.
 */
function parseSort(sortStr) {
  if (typeof sortStr !== 'string' || !sortStr.trim()) return { timestamp: -1, _id: 1 };
  try {
    const parts = sortStr.split(',').map((s) => s.trim()).filter(Boolean);
    const sort = {};
    for (const p of parts) {
      if (!p) continue;
      if (p.startsWith('-')) sort[p.substring(1)] = -1;
      else sort[p] = 1;
    }
    if (!Object.keys(sort).length) return { timestamp: -1, _id: 1 };
    return sort;
  } catch {
    return { timestamp: -1, _id: 1 };
  }
}

/**
 * Trim heavy fields; ensure full users are never included. Keep users_min when present.
 */
function trimHeavyFields(doc) {
  const d = { ...doc };
  if (d && typeof d === 'object') {
    if (d.metadata && typeof d.metadata === 'object') {
      delete d.metadata.largeBlob;
      delete d.metadata.profile;
      delete d.metadata.tokens;
      delete d.metadata.bigData;
      delete d.metadata.attachments;
      const metaStrLen = JSON.stringify(d.metadata || {}).length;
      if (metaStrLen > 64000) d.metadata = { note: 'omitted_large_metadata' };
    }
    if (d.users) delete d.users;
    if (d.user) delete d.user;
  }
  return d;
}

module.exports = { list };
