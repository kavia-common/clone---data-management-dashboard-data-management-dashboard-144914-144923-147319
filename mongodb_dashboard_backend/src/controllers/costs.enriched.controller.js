'use strict';

/**
 * Costs Enriched Controller
 * Adds server-side user_name enrichment for costs by joining users collection.
 * Ensures tenant scoping (organization_id/tenant_id) and protects types by normalizing to string for join keys.
 */

const { getDb } = require('../config/db');
const { buildTenantScopeFilter } = require('../middleware/tenantScope'); // helper pattern used in repo
const { parseJSONSafe } = require('../utils/validation');
const { performance } = require('perf_hooks');

// PUBLIC_INTERFACE
async function listEnrichedCosts(req, res, next) {
  /**
   * This endpoint returns costs with user_name enriched from users collection.
   * - Tenant scoping: honors JWT tenant if present; otherwise uses x-organization-id or ?tenant_id/?organization_id.
   * - Join: $lookup users on localField: user_id (cast to string) to foreignField: _id (cast to string).
   * - Projection: adds user_name: ifNull(arrayElemAt([ "$user.name", 0 ]), "Unknown User").
   * - Filtering: applies allowed filter keys passed via ?filter= JSON (status, provider, llm_model, user_id, session_id, project_id, request_id).
   * - Pagination: page, limit; envelope response with meta.
   *
   * Query params:
   * - page: number (default 1)
   * - limit: number (default 20, max 200)
   * - sort: string (e.g., "-timestamp" or "user_name")
   * - filter: JSON string with whitelisted fields
   */
  const start = performance.now();
  try {
    const db = await getDb();
    const collection = db.collection('llm_costs'); // collection is named llm_costs / llm_cost per repo usage

    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 200;

    // Tenant scope (uses existing middleware/util pattern). Fallback to header/query.
    const {
      tenantId,
      filter: tenantFilter,
      source: tenantSource
    } = buildTenantScopeFilter(req, { headerName: 'x-organization-id' });

    if (!tenantId) {
      return res.status(400).json({ success: false, error: 'Missing tenant (organization) id' });
    }

    // Parse pagination and sort
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
        if (p.startsWith('-')) {
          sort[p.substring(1)] = -1;
        } else {
          sort[p] = 1;
        }
      });
    }

    // Build filter from query.filter but whitelist fields
    const rawFilter = parseJSONSafe(req.query.filter, {});
    const ALLOWED_FILTER = new Set(['status', 'provider', 'llm_model', 'user_id', 'session_id', 'project_id', 'request_id', 'timestamp', 'created_at']);
    const filter = {};
    Object.keys(rawFilter).forEach((k) => {
      if (ALLOWED_FILTER.has(k)) {
        filter[k] = rawFilter[k];
      }
    });

    // Apply tenant scope; server enforces tenant regardless of incoming filter payload
    filter.tenant_id = tenantId;

    // Build aggregation pipeline
    const pipeline = [];

    // Convert any filter equality values to match schema. We do not cast aggressively here; we rely on stored forms.
    pipeline.push({ $match: filter });

    // Normalize for join: create string forms
    pipeline.push({
      $addFields: {
        _user_id_str: {
          $cond: [
            { $ifNull: ['$user_id', false] },
            { $toString: '$user_id' },
            null
          ]
        }
      }
    });

    // Lookup users by casted string _id
    pipeline.push({
      $lookup: {
        from: 'users',
        let: { uid: '$_user_id_str' },
        pipeline: [
          {
            $addFields: {
              _id_str: { $toString: '$_id' }
            }
          },
          {
            $match: {
              $expr: { $eq: ['$_id_str', '$$uid'] }
            }
          },
          {
            $project: {
              _id: 1,
              name: 1
            }
          }
        ],
        as: 'user'
      }
    });

    // Project enriched field
    pipeline.push({
      $addFields: {
        user_name: {
          $ifNull: [
            { $arrayElemAt: ['$user.name', 0] },
            'Unknown User'
          ]
        }
      }
    });

    // Sorting
    if (Object.keys(sort).length > 0) {
      pipeline.push({ $sort: sort });
    }

    // Pagination: compute total and page slice using $facet
    const skip = (page - 1) * limit;
    pipeline.push({
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit }
        ],
        totalCount: [
          { $count: 'count' }
        ]
      }
    });

    const execStart = performance.now();
    const [facet] = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();
    const execEnd = performance.now();

    const items = (facet && facet.items) || [];
    const total = (facet && facet.totalCount && facet.totalCount[0] && facet.totalCount[0].count) || 0;

    // Defensive projection and shape
    const data = items.map((doc) => {
      const {
        user, // remove raw lookup array
        _user_id_str, // internal
        ...rest
      } = doc;
      // Ensure user_name present
      return {
        ...rest,
        user_name: typeof doc.user_name === 'string' && doc.user_name.trim() ? doc.user_name : 'Unknown User'
      };
    });

    // Headers for diagnostics similar to existing pattern
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
