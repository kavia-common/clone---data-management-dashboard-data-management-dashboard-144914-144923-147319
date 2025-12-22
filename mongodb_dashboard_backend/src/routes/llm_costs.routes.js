'use strict';

const express = require('express');
const LLMCost = require('../models/llmCosts.model');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

/**
 * escapeRegex
 * Escapes special characters in a string for safe use within a RegExp source.
 * Local helper kept minimal to avoid importing extra utilities.
 */
// PUBLIC_INTERFACE
function escapeRegex(str) {
  /** Escapes regex meta characters for safe dynamic regex creation. */
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Defensive list route for the legacy underscore path.
 * - Preserves pagination and default sort semantics
 * - Safely guards all $convert/$toString with onError/onNull to avoid 500s on empty/non-numeric values
 * - Aggregation wrapped in try/catch with a find().lean() fallback
 * - Adds diagnostic headers and disables cache/etag to avoid stale responses
 * Response: { success, data, meta } (with pagination also duplicated under meta.pagination for compatibility)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Prevent stale cache interfering with pagination responses (esp. micro-cache up the stack)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.removeHeader?.('ETag');

    // Parse pagination
    const MAX_LIMIT = 200;
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    if (limit > MAX_LIMIT) {
      return res.status(400).json({ success: false, message: `limit must be <= ${MAX_LIMIT}` });
    }
    const skip = (page - 1) * limit;

    // Tenant filter (header/query aliases); do not enforce JWT here, this legacy route is lenient
    const rawOrg =
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      '';
    const filter = {};
    if (rawOrg) {
      const rx = new RegExp(`^${escapeRegex(rawOrg)}$`, 'i');
      filter.$or = [
        { organization_id: rawOrg },
        { organization_id: { $regex: rx } },
        { tenant_id: rawOrg },
        { tenant_id: { $regex: rx } },
      ];
    }

    // Stable sort order
    const sortStage = { timestamp: -1, created_at: -1, _id: -1 };

    // Try aggregate path first (with robust conversions)
    const pipeline = [];
    if (Object.keys(filter).length) pipeline.push({ $match: filter });

    // Guard all conversions and prepare fields
    pipeline.push({
      $addFields: {
        // Dates
        timestamp: {
          $convert: { input: '$timestamp', to: 'date', onError: null, onNull: null },
        },
        created_at: {
          $convert: { input: '$created_at', to: 'date', onError: null, onNull: null },
        },

        // Normalize user_id to string for join safety
        _user_id_str: {
          $convert: { input: '$user_id', to: 'string', onError: null, onNull: null },
        },

        // Numbers: handle strings like "$1.23" by stripping symbols via toString trim chain
        _cost_total_str: {
          $trim: {
            input: {
              $replaceAll: {
                input: {
                  $replaceAll: {
                    input: { $toString: { $ifNull: ['$total_cost', ''] } },
                    find: '$',
                    replacement: '',
                  },
                },
                find: ',',
                replacement: '',
              },
            },
          },
        },
        _cost_usd_str: {
          $trim: {
            input: {
              $replaceAll: {
                input: {
                  $replaceAll: {
                    input: { $toString: { $ifNull: ['$cost_usd', ''] } },
                    find: '$',
                    replacement: '',
                  },
                },
                find: ',',
                replacement: '',
              },
            },
          },
        },
        total_cost: {
          $convert: { input: '$_cost_total_str', to: 'double', onError: null, onNull: null },
        },
        cost_usd: {
          $convert: { input: '$_cost_usd_str', to: 'double', onError: null, onNull: null },
        },

        tokens_in: {
          $convert: { input: '$tokens_in', to: 'int', onError: null, onNull: null },
        },
        tokens_out: {
          $convert: { input: '$tokens_out', to: 'int', onError: null, onNull: null },
        },
        duration_ms: {
          $convert: { input: '$duration_ms', to: 'int', onError: null, onNull: null },
        },
      },
    });

    // Join users to derive user_name (safe for ObjectId/string mismatches)
    pipeline.push({
      $lookup: {
        from: 'users',
        let: { cid: '$_user_id_str' },
        pipeline: [
          {
            $addFields: {
              _id_str: { $convert: { input: '$_id', to: 'string', onError: null, onNull: null } },
              user_id_str: { $convert: { input: '$user_id', to: 'string', onError: null, onNull: null } },
              id_str: { $convert: { input: '$id', to: 'string', onError: null, onNull: null } },
            },
          },
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ['$$cid', '$user_id_str'] },
                  { $eq: ['$$cid', '$id_str'] },
                  { $eq: ['$$cid', '$_id_str'] },
                ],
              },
            },
          },
          {
            $project: {
              name: 1,
              displayName: 1,
              display_name: 1,
              full_name: 1,
              fullName: 1,
              user_name: 1,
              email: 1,
              username: 1,
            },
          },
          { $limit: 1 },
        ],
        as: '_user_doc',
      },
    });

    // Compute user_name with fallback chain
    pipeline.push({
      $addFields: {
        user_name: {
          $let: {
            vars: { u: { $arrayElemAt: ['$_user_doc', 0] } },
            in: {
              $ifNull: [
                '$$u.displayName',
                {
                  $ifNull: [
                    '$$u.display_name',
                    {
                      $ifNull: [
                        '$$u.fullName',
                        {
                          $ifNull: [
                            '$$u.full_name',
                            {
                              $ifNull: ['$$u.user_name', { $ifNull: ['$$u.name', { $ifNull: ['$$u.username', '$$u.email'] }] }],
                            },
                          ],
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
    });

    // Clean temp field
    pipeline.push({ $project: { _user_doc: 0 } });

    pipeline.push({ $sort: sortStage });
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    let total = 0;
    let docs = [];
    let usedFallback = false;

    try {
      // Count with the same match filter
      total = await LLMCost.countDocuments(filter);
      docs = await LLMCost.aggregate(pipeline).allowDiskUse(true).exec();
    } catch (e) {
      // Fallback to find().lean() to ensure endpoint doesn't 500
      usedFallback = true;
      docs = await LLMCost.find(filter)
        .sort(sortStage)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec();

      // Resolve user_name in-memory using users collection
      try {
        const mongoose = require('mongoose');
        const User = require('../models/user.model.js');
        const ids = Array.from(
          new Set(
            (docs || [])
              .map((d) => (d && d.user_id != null ? String(d.user_id) : null))
              .filter(Boolean)
          )
        );

        if (ids.length) {
          const asObjectIds = ids
            .map((s) => {
              try {
                return new mongoose.Types.ObjectId(s);
              } catch {
                return null;
              }
            })
            .filter(Boolean);

          const orConds = [{ user_id: { $in: ids } }, { id: { $in: ids } }];
          if (asObjectIds.length) orConds.push({ _id: { $in: asObjectIds } });

          const users = await User.find(
            { $or: orConds },
            {
              user_id: 1,
              id: 1,
              name: 1,
              displayName: 1,
              display_name: 1,
              full_name: 1,
              fullName: 1,
              user_name: 1,
              email: 1,
              username: 1,
            }
          )
            .lean()
            .exec();

          const normalize = (u) =>
            u?.displayName ||
            u?.display_name ||
            u?.fullName ||
            u?.full_name ||
            u?.user_name ||
            u?.name ||
            u?.username ||
            u?.email ||
            null;

          const keyFor = (u) => {
            if (u?.user_id) return String(u.user_id);
            if (u?.id) return String(u.id);
            if (u?._id) return String(u._id);
            return null;
          };

          const nameMap = new Map();
          for (const u of users || []) {
            const k = keyFor(u);
            const n = normalize(u);
            if (k && n && !nameMap.has(k)) nameMap.set(k, n);
          }

          docs = (docs || []).map((d) => {
            const uid = d && d.user_id != null ? String(d.user_id) : null;
            const user_name = uid && nameMap.has(uid) ? nameMap.get(uid) : null;
            return { ...d, user_name };
          });
        } else {
          docs = (docs || []).map((d) => ({ ...d, user_name: null }));
        }
      } catch {
        // Ensure field exists even if resolution fails
        docs = (docs || []).map((d) => ({ ...d, user_name: d?.user_name ?? null }));
      }

      total = await LLMCost.countDocuments(filter);
    }

    // Diagnostics headers
    try {
      res.setHeader('x-effective-tenant', rawOrg || '');
      res.setHeader('x-llm-filter', JSON.stringify(filter));
      res.setHeader('x-llm-sort', JSON.stringify(sortStage));
      res.setHeader('x-llm-page', String(page));
      res.setHeader('x-llm-limit', String(limit));
      res.setHeader('x-llm-fallback', usedFallback ? 'find' : 'aggregate');
    } catch (_) {}

    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
    const data = skip >= total ? [] : Array.isArray(docs) ? docs : [];

    // Guarantee user_name field exists for frontend table
    if (Array.isArray(data)) {
      for (const d of data) {
        if (!Object.prototype.hasOwnProperty.call(d, 'user_name')) {
          d.user_name = null;
        }
      }
    }

    const meta = {
      page,
      limit,
      total,
      totalPages,
      sort: '-timestamp, -created_at, -_id',
      ...(rawOrg ? { organization_id: rawOrg } : {}),
      diagnostics: {
        headers: {
          effectiveTenant: rawOrg || null,
          fallback: usedFallback ? 'find' : 'aggregate',
        },
      },
    };

    return res.status(200).json({
      success: true,
      data,
      meta,
    });
  })
);

module.exports = router;
