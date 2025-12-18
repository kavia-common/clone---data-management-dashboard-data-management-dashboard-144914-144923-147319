'use strict';

/**
 * Costs Enriched Controller
 * Adds server-side enrichment for users[].user_display_name by joining users collection.
 * Ensures tenant scoping (organization_id/tenant_id) and protects types by normalizing to string for join keys.
 */

const { getDb } = require('../config/db');
const { buildTenantScopeFilter } = require('../middleware/tenantScope'); // helper pattern used in repo
const { parseJSONSafe } = require('../utils/validation');
const { performance } = require('perf_hooks');

 // PUBLIC_INTERFACE
async function listEnrichedCosts(req, res, next) {
  /**
   * This endpoint returns llm_costs enriched with a user_display_name inside each users[] entry.
   * - Tenant scoping: honors JWT tenant if present; otherwise uses x-organization-id or ?tenant_id/?organization_id.
   * - Join: $unwind users, $lookup from 'users' on users.user_id (string) == users._id (string), null-safe.
   * - Projection: adds users.user_display_name using fallbacks:
   *      name -> display_name -> displayName -> username (plus profile.name/full_name/fullName as additional safety).
   * - Regroup: $group back to original llm_costs document shape, preserving all existing fields and users[] items,
   *            attaching user_display_name to each user subdocument.
   * - Filtering: applies allowed filter keys passed via ?filter= JSON (status, provider, llm_model, user_id, session_id, project_id, request_id, timestamp, created_at).
   * - Pagination: page, limit; envelope response with meta.
   */
  const start = performance.now();
  try {
    const db = await getDb();
    const collection = db.collection('llm_costs');

    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 200;

    // Tenant scope
    const {
      tenantId,
      source: tenantSource
    } = buildTenantScopeFilter(req, { headerName: 'x-organization-id' });

    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'Missing tenant (organization) id' });
    }

    // Pagination and sort
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    let limit = parseInt(req.query.limit || `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) {
      return res.status(400).json({ success: false, error: `limit must be <= ${MAX_LIMIT}` });
    }
    const sortString = (req.query.sort || '-timestamp').trim();
    const sort = {};
    if (sortString) {
      sortString.split(',').forEach((part) => {
        const p = part.trim();
        if (!p) return;
        if (p.startsWith('-')) sort[p.substring(1)] = -1;
        else sort[p] = 1;
      });
    }

    // Build filter (whitelisted)
    const rawFilter = parseJSONSafe(req.query.filter, {});
    const ALLOWED_FILTER = new Set([
      'status','provider','llm_model','user_id','session_id','project_id','request_id','timestamp','created_at'
    ]);
    const filter = {};
    Object.keys(rawFilter).forEach((k) => {
      if (ALLOWED_FILTER.has(k)) filter[k] = rawFilter[k];
    });
    filter.tenant_id = tenantId;

    // Aggregation:
    // 1) $match by filter
    // 2) $addFields original snapshot for regroup keys
    // 3) $unwind users (preserve empty)
    // 4) compute users._uid_str and lookup into users collection by string _id
    // 5) $addFields users.user_display_name with fallbacks (null-safe)
    // 6) $group back to root preserving original fields and reassembling users array
    // 7) $sort, $facet for pagination and total count
    const pipeline = [];

    pipeline.push({ $match: filter });

    // Prepare grouping keys by capturing all fields except users so we can $first them on regroup
    pipeline.push({
      $addFields: {
        __root_copy: '$$ROOT'
      }
    });

    // Unwind users (we must enrich each user entry)
    pipeline.push({
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true
      }
    });

    // Prepare string user id for join
    pipeline.push({
      $addFields: {
        'users._uid_str': {
          $cond: [
            { $ifNull: ['$users.user_id', false] },
            { $toString: '$users.user_id' },
            null
          ]
        }
      }
    });

    // Lookup from users collection using string equality
    pipeline.push({
      $lookup: {
        from: 'users',
        let: { uid: '$users._uid_str' },
        pipeline: [
          { $addFields: { _id_str: { $toString: '$_id' } } },
          { $match: { $expr: { $eq: ['$_id_str', '$$uid'] } } },
          {
            $project: {
              _id: 1,
              name: 1,
              display_name: 1,
              displayName: 1,
              username: 1,
              full_name: 1,
              fullName: 1,
              'profile.name': 1
            }
          }
        ],
        as: '__matched_user'
      }
    });

    // Compute user_display_name with fallbacks
    pipeline.push({
      $addFields: {
        'users.user_display_name': {
          $let: {
            vars: { u: { $arrayElemAt: ['__$matched_user', 0] } },
            in: {
              $ifNull: [
                {
                  $trim: {
                    input: {
                      $ifNull: [
                        '$$u.name',
                        {
                          $ifNull: [
                            '$$u.display_name',
                            {
                              $ifNull: [
                                '$$u.displayName',
                                {
                                  $ifNull: [
                                    '$$u.username',
                                    {
                                      $ifNull: [
                                        '$$u.profile.name',
                                        {
                                          $ifNull: ['$$u.full_name', '$$u.fullName']
                                        }
                                      ]
                                    }
                                  ]
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  }
                },
                null
              ]
            }
          }
        }
      }
    });

    // Clean helper array
    pipeline.push({
      $project: {
        __matched_user: 0
      }
    });

    // Regroup to original documents and reassemble users array
    pipeline.push({
      $group: {
        _id: '$_id',
        doc: { $first: '$__root_copy' },
        users_arr: {
          $push: '$users'
        }
      }
    });

    // Reattach enriched users array while preserving all original fields
    pipeline.push({
      $addFields: {
        'doc.users': {
          $filter: {
            input: '$users_arr',
            as: 'u',
            cond: { $ne: ['$$u', null] }
          }
        }
      }
    });

    // Replace root with reconstructed doc
    pipeline.push({
      $replaceRoot: { newRoot: '$doc' }
    });

    // Sorting
    if (Object.keys(sort).length > 0) {
      pipeline.push({ $sort: sort });
    }

    // Pagination facet
    const skip = (page - 1) * limit;
    pipeline.push({
      $facet: {
        items: [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: 'count' }]
      }
    });

    const execStart = performance.now();
    const [facet] = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();
    const execEnd = performance.now();

    const items = (facet && facet.items) || [];
    const total = (facet && facet.totalCount && facet.totalCount[0] && facet.totalCount[0].count) || 0;

    // Ensure null-safe user_display_name (fallback to Unknown User) when users array exists
    const data = items.map((doc) => {
      const out = { ...doc };
      if (Array.isArray(out.users)) {
        out.users = out.users.map((u) => {
          const disp =
            typeof u?.user_display_name === 'string' && u.user_display_name.trim()
              ? u.user_display_name.trim()
              : 'Unknown User';
          return { ...u, user_display_name: disp };
        });
      }
      return out;
    });

    // Headers for diagnostics
    res.setHeader('x-effective-tenant', tenantId);
    res.setHeader('x-tenant-source', tenantSource || 'unknown');
    res.setHeader('x-costs-sort', JSON.stringify(sort));
    res.setHeader('x-costs-limit', String(limit));
    res.setHeader('x-costs-page', String(page));

    const builtMs = Math.round(execStart - start);
    const execMs = Math.round(execEnd - execStart);
    res.setHeader('x-costs-timing-built-ms', String(builtMs));
    res.setHeader('x-costs-timing-exec-ms', String(execMs));

    return res.json({
      success: true,
      data,
      meta: {
        page,
        limit,
        total,
        sort: sortString,
        diagnostics: {
          headers: {
            tenantSource
          }
        }
      }
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listEnrichedCosts
};
