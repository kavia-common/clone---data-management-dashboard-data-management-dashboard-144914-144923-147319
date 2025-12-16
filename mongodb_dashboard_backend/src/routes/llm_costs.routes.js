'use strict';

const express = require('express');
const LLMCost = require('../models/llmCosts.model');
const { asyncHandler, success } = require('../utils/http');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Organization-level aggregates from llm_costs with nested/flat shapes support.
 * Returns one row per organization_id with:
 *  - organization_id
 *  - organization_cost (sum of costs)
 *  - users (count)
 *  - projects (count)
 *  - cost (alias of organization_cost)
 * Pagination via ?page & ?limit is applied to organizations (not raw docs).
 * Diagnostics headers:
 *  - X-LLM-COSTS-Collection
 *  - X-LLM-COSTS-Mode: nested|flat|mixed
 *  - X-LLM-COSTS-Matched: pre-match filter used (JSON)
 *  - X-LLM-COSTS-Reason: included when empty or fallback used
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const maxLimit = 100;
    const parsedPage = parseInt(req.query.page, 10);
    const parsedLimit = parseInt(req.query.limit, 10);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limitRaw = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
    const limit = Math.min(Math.max(limitRaw, 1), maxLimit);
    const skip = (page - 1) * limit;

    const orgIdRaw = (req.query.organization_id || req.query.tenant_id || '').toString().trim();
    const hasOrg = !!orgIdRaw;

    // Pre-match by organization_id aliases (exact)
    let baseMatch = {};
    if (hasOrg) {
      baseMatch = {
        $or: [
          { organization_id: orgIdRaw },
          { tenant_id: orgIdRaw },
          { org_id: orgIdRaw },
          { tenantId: orgIdRaw },
        ],
      };
    }

    // Build $facet with two branches: nested-first and flat-fallback
    const pipeline = [];

    if (hasOrg) {
      pipeline.push({ $match: baseMatch });
    }

    pipeline.push({
      $facet: {
        nested: [
          // Ensure documents with users array
          { $match: { users: { $type: 'array' } } },
          // Projection to compute users count, projects count, and organization_cost via $reduce
          {
            $project: {
              organization_id: {
                $ifNull: [
                  '$organization_id',
                  { $ifNull: ['$tenant_id', { $ifNull: ['$org_id', '$tenantId'] }] },
                ],
              },
              users: { $size: '$users' },
              projects: {
                $cond: [
                  { $isArray: '$projects' },
                  { $size: '$projects' },
                  0,
                ],
              },
              organization_cost: {
                $reduce: {
                  input: '$users',
                  initialValue: 0,
                  in: {
                    $add: [
                      '$$value',
                      { $ifNull: ['$$this.user_cost', 0] },
                    ],
                  },
                },
              },
            },
          },
          {
            $group: {
              _id: '$organization_id',
              users: { $max: '$users' }, // per doc count; using max as org-level count (docs store org summary)
              projects: { $max: '$projects' },
              organization_cost: { $sum: { $ifNull: ['$organization_cost', 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              organization_id: '$_id',
              organization_cost: { $ifNull: ['$organization_cost', 0] },
              users: { $ifNull: ['$users', 0] },
              projects: { $ifNull: ['$projects', 0] },
              cost: { $ifNull: ['$organization_cost', 0] },
              _mode: { $literal: 'nested' },
            },
          },
        ],
        flat: [
          // Ensure docs without users array => flat shape
          { $match: { users: { $exists: false } } },
          {
            $project: {
              organization_id: {
                $ifNull: [
                  '$organization_id',
                  { $ifNull: ['$tenant_id', { $ifNull: ['$org_id', '$tenantId'] }] },
                ],
              },
              user_id: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$user_id', null] },
                      { $ne: [{ $type: '$user_id' }, 'missing'] },
                    ],
                  },
                  { $toString: '$user_id' },
                  null,
                ],
              },
              project_id: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$project_id', null] },
                      { $ne: [{ $type: '$project_id' }, 'missing'] },
                    ],
                  },
                  { $toString: '$project_id' },
                  null,
                ],
              },
              cost_num: {
                $ifNull: [
                  {
                    $cond: [
                      { $isNumber: '$cost' },
                      { $toDouble: '$cost' },
                      {
                        $cond: [
                          { $isNumber: '$total_cost' },
                          { $toDouble: '$total_cost' },
                          0,
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
            },
          },
          {
            $group: {
              _id: '$organization_id',
              organization_cost: { $sum: { $ifNull: ['$cost_num', 0] } },
              usersSet: {
                $addToSet: {
                  $cond: [{ $ne: ['$user_id', null] }, '$user_id', '$$REMOVE'],
                },
              },
              projectsSet: {
                $addToSet: {
                  $cond: [{ $ne: ['$project_id', null] }, '$project_id', '$$REMOVE'],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              organization_id: '$_id',
              organization_cost: { $ifNull: ['$organization_cost', 0] },
              users: {
                $size: {
                  $filter: { input: '$usersSet', as: 'u', cond: { $ne: ['$$u', null] } },
                },
              },
              projects: {
                $size: {
                  $filter: { input: '$projectsSet', as: 'p', cond: { $ne: ['$$p', null] } },
                },
              },
              cost: { $ifNull: ['$organization_cost', 0] },
              _mode: { $literal: 'flat' },
            },
          },
        ],
      },
    });

    // Merge nested and flat; if both present, group by org and sum costs; take max of users/projects
    pipeline.push(
      {
        $project: {
          combined: { $concatArrays: ['$nested', '$flat'] },
        },
      },
      { $unwind: { path: '$combined', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$combined.organization_id',
          organization_cost: { $sum: { $ifNull: ['$combined.organization_cost', 0] } },
          users: { $max: { $ifNull: ['$combined.users', 0] } },
          projects: { $max: { $ifNull: ['$combined.projects', 0] } },
          modes: { $addToSet: '$combined._mode' },
        },
      },
      {
        $project: {
          _id: 0,
          organization_id: '$_id',
          organization_cost: 1,
          users: 1,
          projects: 1,
          cost: '$organization_cost',
          _mode: {
            $cond: [
              { $gt: [{ $size: '$modes' }, 1] },
              'mixed',
              { $ifNull: [{ $arrayElemAt: ['$modes', 0] }, 'flat'] },
            ],
          },
        },
      }
    );

    // Sort, paginate, and count
    pipeline.push(
      { $sort: { organization_cost: -1, organization_id: 1 } },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: limit }],
          totalAgg: [{ $count: 'count' }],
        },
      }
    );

    // Execute initial pipeline
    let [facet] = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
    facet = facet || { rows: [], totalAgg: [] };
    let rows = Array.isArray(facet.rows) ? facet.rows : [];
    let total = Array.isArray(facet.totalAgg) && facet.totalAgg[0] ? facet.totalAgg[0].count : 0;

    let modeHeader = 'mixed';
    if (rows.length) {
      const modes = new Set(rows.map((r) => r?._mode || 'flat'));
      modeHeader = modes.size > 1 ? 'mixed' : [...modes][0];
    }

    // If org filter yielded zero, try case-insensitive fallback
    let usedCiFallback = false;
    if (hasOrg && total === 0) {
      usedCiFallback = true;
      const ciMatch = {
        $or: [
          { organization_id: { $regex: `^${orgIdRaw}$`, $options: 'i' } },
          { tenant_id: { $regex: `^${orgIdRaw}$`, $options: 'i' } },
          { org_id: { $regex: `^${orgIdRaw}$`, $options: 'i' } },
          { tenantId: { $regex: `^${orgIdRaw}$`, $options: 'i' } },
        ],
      };

      const fallbackPipeline = [{ $match: ciMatch }, ...pipeline.slice(1)];
      let [facet2] = await LLMCost.aggregate(fallbackPipeline, { allowDiskUse: true });
      facet2 = facet2 || { rows: [], totalAgg: [] };
      rows = Array.isArray(facet2.rows) ? facet2.rows : [];
      total = Array.isArray(facet2.totalAgg) && facet2.totalAgg[0] ? facet2.totalAgg[0].count : 0;

      if (!rows.length) {
        res.setHeader('X-LLM-COSTS-Reason', 'No records after case-insensitive tenant match.');
      }

      if (rows.length) {
        const modes = new Set(rows.map((r) => r?._mode || 'flat'));
        modeHeader = modes.size > 1 ? 'mixed' : [...modes][0];
      }
    }

    // Set diagnostics headers
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Matched', hasOrg ? JSON.stringify(baseMatch) : '{}');
      res.setHeader('X-LLM-COSTS-Matched-CI', hasOrg && usedCiFallback ? 'true' : 'false');
      res.setHeader('X-LLM-COSTS-Mode', modeHeader || 'flat');
      if (total === 0) {
        res.setHeader('X-LLM-COSTS-Reason', 'Empty response after aggregation.');
      }
    } catch {}

    // Final response
    return success(
      res,
      rows.map((r) => ({
        organization_id: r.organization_id,
        organization_cost: r.organization_cost ?? 0,
        users: r.users ?? 0,
        projects: r.projects ?? 0,
        cost: r.organization_cost ?? 0,
      })),
      { page, limit, total },
      200
    );
  })
);

module.exports = router;
