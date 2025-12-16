'use strict';

const express = require('express');
const LLMCost = require('../models/llmCosts.model');
const { asyncHandler, success } = require('../utils/http');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Aggregated view from llm_costs collection filtered by organization_id.
 * Returns fields: organization_id, organization_name, organization_cost, users (count of users with projects),
 * user_id, type, user_cost, projects (count of projects per user).
 * Always paginated; supports ?page=&limit=. Adds diagnostics headers.
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

    let match = {};
    if (hasOrg) {
      match = {
        $or: [
          { organization_id: orgIdRaw },
          { tenant_id: orgIdRaw },
          { org_id: orgIdRaw },
          { tenantId: orgIdRaw },
        ],
      };
    }

    const projectNormalized = {
      organization_id: {
        $ifNull: [
          '$organization_id',
          { $ifNull: ['$tenant_id', { $ifNull: ['$org_id', '$tenantId'] }] },
        ],
      },
      organization_name: { $ifNull: ['$organization_name', null] },
      user_id: { $cond: [{ $ne: ['$user_id', null] }, { $toString: '$user_id' }, null] },
      type: { $ifNull: ['$type', { $ifNull: ['$service_type', '$operation'] }] },
      project_id: { $cond: [{ $ne: ['$project_id', null] }, { $toString: '$project_id' }, null] },
      total_cost_num: {
        $cond: [
          { $isNumber: '$total_cost' },
          { $toDouble: '$total_cost' },
          {
            $convert: {
              input: {
                $replaceAll: {
                  input: { $toString: '$total_cost' },
                  find: '$',
                  replacement: '',
                },
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
        ],
      },
    };

    const baseStages = [
      { $project: projectNormalized },
      {
        $group: {
          _id: {
            organization_id: '$organization_id',
            organization_name: '$organization_name',
            user_id: '$user_id',
            type: '$type',
          },
          user_cost: { $sum: '$total_cost_num' },
          projectsSet: { $addToSet: '$project_id' },
        },
      },
      {
        $project: {
          _id: 0,
          organization_id: '$_id.organization_id',
          organization_name: '$_id.organization_name',
          user_id: '$_id.user_id',
          type: { $ifNull: ['$_id.type', null] },
          user_cost: { $ifNull: ['$user_cost', 0] },
          projects: {
            $size: { $filter: { input: '$projectsSet', as: 'pid', cond: { $ne: ['$$pid', null] } } },
          },
        },
      },
      {
        $group: {
          _id: '$organization_id',
          organization_name: { $first: '$organization_name' },
          records: {
            $push: {
              user_id: '$user_id',
              type: '$type',
              user_cost: '$user_cost',
              projects: '$projects',
            },
          },
          organization_cost: { $sum: '$user_cost' },
          users_with_projects: {
            $addToSet: { $cond: [{ $gt: ['$projects', 0] }, '$user_id', null] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          organization_id: '$_id',
          organization_name: 1,
          organization_cost: { $ifNull: ['$organization_cost', 0] },
          users: {
            $size: {
              $filter: { input: '$users_with_projects', as: 'uid', cond: { $ne: ['$$uid', null] } },
            },
          },
          records: 1,
        },
      },
      { $unwind: '$records' },
      {
        $project: {
          organization_id: 1,
          organization_name: 1,
          organization_cost: { $round: ['$organization_cost', 6] },
          users: 1,
          user_id: '$records.user_id',
          type: '$records.type',
          user_cost: { $round: ['$records.user_cost', 6] },
          projects: '$records.projects',
        },
      },
      { $sort: { user_cost: -1, organization_id: 1, user_id: 1, type: 1 } },
    ];

    const makeFacetPipeline = (preMatch) => {
      const stages = [];
      if (preMatch) stages.push({ $match: preMatch });
      stages.push(...baseStages);
      return [
        ...stages,
        {
          $facet: {
            rows: [{ $skip: skip }, { $limit: limit }],
            totalCount: [{ $count: 'count' }],
          },
        },
      ];
    };

    let aggPipeline = makeFacetPipeline(hasOrg ? match : null);
    let [{ rows = [], totalCount = [] } = {}] = await LLMCost.aggregate(aggPipeline, { allowDiskUse: true });
    let total = totalCount && totalCount[0] ? totalCount[0].count : 0;

    // fallback to case-insensitive if org specified and no results
    if (hasOrg && total === 0) {
      const ciMatch = {
        $or: [
          { organization_id: { $regex: `^${orgIdRaw}$`, $options: 'i' } },
          { tenant_id: { $regex: `^${orgIdRaw}$`, $options: 'i' } },
          { org_id: { $regex: `^${orgIdRaw}$`, $options: 'i' } },
          { tenantId: { $regex: `^${orgIdRaw}$`, $options: 'i' } },
        ],
      };
      aggPipeline = makeFacetPipeline(ciMatch);
      [{ rows = [], totalCount = [] } = {}] = await LLMCost.aggregate(aggPipeline, { allowDiskUse: true });
      total = totalCount && totalCount[0] ? totalCount[0].count : 0;
      if (!rows.length) {
        res.setHeader('X-LLM-COSTS-Reason', 'No records after case-insensitive tenant match.');
      }
    }

    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Matched', hasOrg ? JSON.stringify(match) : '{}');
      res.setHeader('X-LLM-COSTS-PostGroupCount', String(total));
    } catch {}

    return success(res, rows || [], { page, limit, total, organization_id: hasOrg ? orgIdRaw : null }, 200);
  })
);

module.exports = router;
