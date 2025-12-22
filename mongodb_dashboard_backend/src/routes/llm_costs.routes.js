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
