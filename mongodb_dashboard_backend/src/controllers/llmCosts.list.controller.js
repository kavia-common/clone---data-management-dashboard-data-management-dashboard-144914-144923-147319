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
 * - Never use `user: 1` style projection on llm-costs because legacy documents may embed very large user sub-documents.
 *   Doing so forces MongoDB to load and serialize heavy blobs which can trigger timeouts and memory pressure.
 * - Default behavior excludes any embedded user entirely.
 * - When minimal user info is requested via ?include_user=min, we fetch ONLY a small whitelist by referencing users collection
 *   through an indexed $lookup using a normalized user identifier (user_id/email). We $project the minimal subset:
 *   { _id, user_id, displayName/name, email }. No other user fields are returned.
 * - Hard caps: page size limited (max 200); non-paginated path capped to 50. Payload size guard trims each doc to <= ~64KB by dropping
 *   large fields best-effort. Queries use lean() and bounded maxTimeMS to avoid long-running ops.
 */
async function list(req, res) {
  // Disable caching defensively
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

  // Build filter: start with tenant filter unless bypassed
  let filter = {};
  const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass);
  const tenant = bypass ? null : (req.tenantId || req.organizationId || (req.auth?.tenantId ? String(req.auth.tenantId) : null));
  if (tenant) {
    filter.$or = [
      { tenant_id: String(tenant) },
      { organization_id: String(tenant) },
      { orgId: String(tenant) },
      { tenantId: String(tenant) },
      { organizationId: String(tenant) },
      { 'tenant.tenant_id': String(tenant) },
    ];
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
    return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
  }

  // Determine if user should be included and how.
  // Guardrail: exclude user by default. When include_user=min, we join to users and return a small whitelist.
  const includeUserMode = (req.query?.include_user || '').toString().trim().toLowerCase();
  const includeUserMin = includeUserMode === 'min';

  // Baseline projection of llm-costs fields (explicit whitelist; exclude any embedded heavy user fields)
  const baseProject = {
    _id: 1,
    tenant_id: 1,
    organization_id: 1,
    user_id: 1, // store only reference here
    project_id: 1,
    agent: 1,
    agent_name: 1,
    'metadata.agent': 1,
    'metadata.Agent Name': 1,
    total_cost: { $ifNull: ['$total_cost', { $ifNull: ['$cost_usd', 0] }] },
    cost_usd: 1,
    'cost.amount': 1,
    'cost.currency': 1,
    timestamp: 1,
    created_at: 1,
    organization_cost: 1,
    projects: 1,
    // IMPORTANT: never do user:1 here — see header docs
    user: 0, // if any embedded user exists, force exclude
    'user.largeBlob': 0,
    'user.profile': 0,
    'user.tokens': 0,
    'user.bigData': 0,
  };

  // Guard when no explicit pagination to avoid huge arrays in memory
  const guardLimit = usingExplicitPagination ? limit : Math.min(50, maxLimit);
  const skip = usingExplicitPagination ? (page - 1) * limit : 0;

  // Use Mongo maxTimeMS if provided by route, and clamp to [200, 2000]
  const maxTimeMS = Math.max(200, Math.min(Number(req.maxTimeMS || 1000), 2000));

  try {
    // If no user join requested, use simple find() with projection
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
        // Optional payload hard cap: drop any doc bigger than ~64KB by removing metadata heavy fields
        const trimmed = (items || []).map(trimHeavyFields);
        return res.status(200).json({
          success: true,
          data: trimmed,
          meta: { page, limit, total },
        });
      }

      const items = await query.exec();
      const trimmed = (items || []).map(trimHeavyFields);
      return res.status(200).json(trimmed);
    }

    // include_user=min: perform aggregation with bounded $project then $lookup to users with minimal whitelist.
    // Try to use user_id as primary join key. As fallbacks, attempt normalized email if present.
    const usersColl = User.collection?.name || 'users';

    // Build pipeline
    const pipeline = [];

    // 1) $match early with tenant filter and user query filter
    if (filter && Object.keys(filter).length) {
      pipeline.push({ $match: filter });
    }

    // 2) $project minimal fields EARLY to short-circuit large docs before $sort/$skip/$limit
    pipeline.push({
      $project: {
        ...baseProject,
        // Keep a normalized join key for lookup
        _join_user_id: {
          $toString: {
            $ifNull: ['$user_id', ''],
          },
        },
        _join_email: {
          $toLower: {
            $toString: { $ifNull: ['$email', ''] },
          },
        },
      },
    });

    // 3) $sort using provided sort (fallback to timestamp desc)
    const mongoSort = parseSort(sort);
    if (Object.keys(mongoSort).length) {
      pipeline.push({ $sort: mongoSort });
    }

    // 4) $skip + $limit for pagination windowing before $lookup to keep join set small
    if (skip > 0) pipeline.push({ $skip: skip });
    pipeline.push({ $limit: guardLimit });

    // 5) $lookup minimal fields from users based on user_id; if not found by user_id, optionally by email
    pipeline.push({
      $lookup: {
        from: usersColl,
        let: { uid: '$_join_user_id', uemail: '$_join_email', org: '$organization_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  // Accept either user_id==uid OR email==uemail (when uid missing)
                  {
                    $or: [
                      {
                        $and: [
                          { $ne: ['$$uid', ''] },
                          { $eq: [{ $toString: '$user_id' }, '$$uid'] },
                        ],
                      },
                      {
                        $and: [
                          { $ne: ['$$uemail', ''] },
                          { $eq: [{ $toLower: { $ifNull: ['$email', ''] } }, '$$uemail'] },
                        ],
                      },
                    ],
                  },
                  // If llmCost has organization_id, try to match same tenant in users to avoid cross-tenant collisions
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
              // Minimal name fields whitelist
              displayName: 1,
              display_name: 1,
              name: 1,
              full_name: 1,
              fullName: 1,
            },
          },
          { $limit: 1 }, // bound user join to single minimal doc
        ],
        as: '_user',
      },
    });

    // 6) $addFields: materialize minimal user object (flatten first match)
    pipeline.push({
      $addFields: {
        user_min: {
          $let: {
            vars: { u: { $first: '_user' } },
            in: {
              _id: '$$u._id',
              user_id: '$$u.user_id',
              email: '$$u.email',
              displayName: {
                $ifNull: [
                  '$$u.displayName',
                  {
                    $ifNull: [
                      '$$u.display_name',
                      {
                        $ifNull: [
                          '$$u.fullName',
                          {
                            $ifNull: ['$$u.full_name', { $ifNull: ['$$u.name', null] }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    });

    // 7) $project: exclude helper fields and any embedded user
    pipeline.push({
      $project: {
        _user: 0,
        _join_user_id: 0,
        _join_email: 0,
        user: 0,
        'user.largeBlob': 0,
        'user.profile': 0,
        'user.tokens': 0,
        'user.bigData': 0,
      },
    });

    // Execute with lean aggregate and maxTimeMS
    const agg = LLMCost.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS });
    const items = await agg.exec();

    // Payload hard cap trimming
    const trimmed = (items || []).map(trimHeavyFields);

    if (usingExplicitPagination) {
      // countDocuments with same filter (count before pagination window)
      const total = await LLMCost.countDocuments(filter).maxTimeMS(maxTimeMS).exec();
      return res.status(200).json({
        success: true,
        data: trimmed,
        meta: { page, limit, total },
      });
    }

    return res.status(200).json(trimmed);
  } catch (err) {
    const msg = String(err?.message || err);
    const isMongoTimeout = /operation exceeded time limit|timed out|MaxTimeMS/i.test(msg);
    const status = isMongoTimeout ? 206 : 500;
    return res.status(status).json({
      success: false,
      message: isMongoTimeout ? 'Query exceeded time limit' : 'Internal server error',
      data: [],
      meta: { timedOut: isMongoTimeout, maxTimeMS, page: usingExplicitPagination ? page : undefined, limit: usingExplicitPagination ? limit : undefined },
    });
  }
}

/**
 * Convert sort string like "-timestamp,name" into Mongo sort document.
 * Falls back to { timestamp: -1 } when invalid.
 */
function parseSort(sortStr) {
  if (typeof sortStr !== 'string' || !sortStr.trim()) return { timestamp: -1, _id: 1 };
  try {
    const parts = sortStr.split(',').map(s => s.trim()).filter(Boolean);
    const sort = {};
    for (const p of parts) {
      if (!p) continue;
      if (p.startsWith('-')) {
        sort[p.substring(1)] = -1;
      } else {
        sort[p] = 1;
      }
    }
    if (!Object.keys(sort).length) return { timestamp: -1, _id: 1 };
    return sort;
  } catch {
    return { timestamp: -1, _id: 1 };
  }
}

/**
 * Trim heavy fields from a result doc to enforce a soft payload cap per document.
 * Drops known heavy fields under metadata and user if size seems large.
 */
function trimHeavyFields(doc) {
  const d = { ...doc };
  // Soft cap: if metadata contains large blobs, drop likely heavy keys
  if (d && typeof d === 'object') {
    if (d.metadata && typeof d.metadata === 'object') {
      // Drop potentially heavy nested trees commonly found
      delete d.metadata.largeBlob;
      delete d.metadata.profile;
      delete d.metadata.tokens;
      delete d.metadata.bigData;
      delete d.metadata.attachments;
      delete d.metadata.blob;
      // If metadata still looks huge (heuristic), remove it entirely
      const metaStrLen = JSON.stringify(d.metadata || {}).length;
      if (metaStrLen > 64000) {
        d.metadata = { note: 'omitted_large_metadata' };
      }
    }
    // Always ensure embedded user is not present unless minimal user was requested under user_min
    if (d.user && !d.user_min) {
      delete d.user;
    }
  }
  return d;
}

module.exports = { list };
