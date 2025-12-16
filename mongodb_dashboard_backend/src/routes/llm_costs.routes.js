'use strict';

const express = require('express');
const LLMCost = require('../models/llmCosts.model');
const { asyncHandler, success } = require('../utils/http');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Robust org-level aggregation supporting nested and flat shapes.
 * - Optional organization_id scoping
 * - Pagination (page>=1, limit<=100)
 * - Diagnostics headers for mode and matched counts
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // 1) Parse query params and clamp
    const maxLimit = 100;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
    const skip = (page - 1) * limit;

    const organization_id = (req.query.organization_id || '').toString().trim();
    const preMatch = organization_id ? { organization_id } : {};

    // 2) Pre-match stage
    const pipeline = [];
    if (organization_id) {
      pipeline.push({ $match: { organization_id } });
    }

    // 3) Facet with nested and flat branches
    const nestedBranch = [
      { $match: { users: { $type: 'array' } } },
      {
        $project: {
          organization_id: 1,
          organization_name: 1,
          usersCount: { $size: { $ifNull: ['$users', []] } },
          projectsCount: {
            $cond: [{ $isArray: '$projects' }, { $size: '$projects' }, 0],
          },
          usersCost: {
            $reduce: {
              input: { $ifNull: ['$users', []] },
              initialValue: 0,
              in: { $add: ['$$value', { $ifNull: ['$$this.user_cost', 0] }] },
            },
          },
        },
      },
      {
        $group: {
          _id: { organization_id: '$organization_id', organization_name: '$organization_name' },
          organization_cost: { $sum: '$usersCost' },
          users: { $sum: '$usersCount' },
          projects: { $sum: '$projectsCount' },
        },
      },
      {
        $project: {
          _id: 0,
          organization_id: '$_id.organization_id',
          organization_name: '$_id.organization_name',
          organization_cost: 1,
          users: 1,
          projects: 1,
          cost: '$organization_cost',
          _mode: { $literal: 'nested' },
        },
      },
    ];

    const flatBranch = [
      { $match: { users: { $exists: false } } },
      {
        $project: {
          organization_id: 1,
          organization_name: 1,
          cost: { $ifNull: ['$cost', 0] },
          user_id: 1,
          project_id: 1,
        },
      },
      {
        $group: {
          _id: { organization_id: '$organization_id', organization_name: '$organization_name' },
          organization_cost: { $sum: '$cost' },
          usersSet: { $addToSet: '$user_id' },
          projectsSet: { $addToSet: '$project_id' },
        },
      },
      {
        $project: {
          _id: 0,
          organization_id: '$_id.organization_id',
          organization_name: '$_id.organization_name',
          organization_cost: 1,
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
          cost: '$organization_cost',
          _mode: { $literal: 'flat' },
        },
      },
    ];

    // 4) Merge branches and normalize
    pipeline.push(
      {
        $facet: {
          nested: nestedBranch,
          flat: flatBranch,
        },
      },
      { $project: { combined: { $concatArrays: ['$nested', '$flat'] } } },
      { $unwind: { path: '$combined', preserveNullAndEmptyArrays: true } },
      { $replaceRoot: { newRoot: '$combined' } },
      {
        $group: {
          _id: {
            organization_id: '$organization_id',
            organization_name: '$organization_name',
          },
          organization_cost: { $sum: '$organization_cost' },
          users: { $max: '$users' },
          projects: { $max: '$projects' },
          modes: { $addToSet: '$_mode' },
        },
      },
      {
        $project: {
          _id: 0,
          organization_id: '$_id.organization_id',
          organization_name: '$_id.organization_name',
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
      },
      { $sort: { organization_cost: -1, organization_id: 1 } },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: limit }],
          meta: [{ $count: 'total' }],
        },
      }
    );

    // 5) Execute pipeline safely
    const [facet] = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
    const rows = (facet && Array.isArray(facet.rows)) ? facet.rows : [];
    const total = (facet && Array.isArray(facet.meta) && facet.meta[0]?.total) ? facet.meta[0].total : 0;

    // 6) Diagnostics headers
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      const modes = new Set(rows.map(r => r?._mode || 'flat'));
      const modeHeader = modes.size === 0 ? 'flat' : (modes.size === 1 ? [...modes][0] : 'mixed');
      res.setHeader('X-LLM-COSTS-Mode', modeHeader);
      res.setHeader('X-LLM-COSTS-MatchedPreFacet', JSON.stringify(preMatch));
      res.setHeader('X-LLM-COSTS-Total', String(total));
    } catch {}

    // 7) Return envelope, empty ok
    return success(
      res,
      rows.map(r => ({
        organization_id: r.organization_id,
        organization_name: r.organization_name ?? null,
        organization_cost: r.organization_cost ?? 0,
        users: r.users ?? 0,
        projects: r.projects ?? 0,
        cost: r.cost ?? r.organization_cost ?? 0,
      })),
      { page, limit, total },
      200
    );
  })
);

module.exports = router;
