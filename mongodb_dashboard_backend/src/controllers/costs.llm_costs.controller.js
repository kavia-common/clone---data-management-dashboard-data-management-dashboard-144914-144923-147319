'use strict';

const LLMCost = require('../models/llmCosts.model');
const { success, failure } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs
 *
 * Reads from the 'llm_costs' collection (configurable via env: LLMCOSTS_COLLECTION_NAME or LLM_COSTS_COLLECTION).
 * Returns aggregated rows filtered by organization_id (query param), using an aggregation pipeline:
 * - $match on organization_id, with case-insensitive fallback and common alias keys (tenant_id, org_id, tenantId)
 * - $project normalization for keys and cost parsing
 * - $group to produce per-user rollup with counts of projects and cost sum
 * - $group to compute organization totals and users count (users that created projects)
 * - $unwind + $project to flatten results, rounding costs to 6 decimals
 * Supports simple pagination with page & limit query params. If page/limit not provided, returns a raw array.
 *
 * Query params:
 * - organization_id: required string. Alias support is via pipeline $match ($or: tenant_id/org_id/tenantId).
 * - page, limit: optional pagination. Defaults only apply if provided; otherwise a raw array is returned.
 */
async function getLlmCostsAggregated(req, res) {
  try {
    const orgId = String(req.query.organization_id || '').trim();
    if (!orgId) {
      return failure(res, 'organization_id query parameter is required', 400);
    }

    // optional pagination
    const hasPage = Object.prototype.hasOwnProperty.call(req.query, 'page');
    const hasLimit = Object.prototype.hasOwnProperty.call(req.query, 'limit');
    const paginate = hasPage || hasLimit;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    const matchStage = {
      $match: {
        $or: [
          { organization_id: orgId },
          { tenant_id: orgId },
          { org_id: orgId },
          { tenantId: orgId },
          { organization_id: { $regex: `^${orgId}$`, $options: 'i' } },
          { tenant_id: { $regex: `^${orgId}$`, $options: 'i' } }
        ]
      }
    };

    const projectNormalized = {
      organization_id: {
        $ifNull: [
          '$organization_id',
          { $ifNull: ['$tenant_id', { $ifNull: ['$org_id', '$tenantId'] }] },
        ],
      },
      organization_name: { $ifNull: ['$organization_name', null] },
      user_id: { $toString: '$user_id' },
      type: {
        $ifNull: [
          '$type',
          { $ifNull: ['$service_type', '$operation'] },
        ],
      },
      project_id: {
        $cond: [
          { $ne: ['$project_id', null] },
          { $toString: '$project_id' },
          null,
        ],
      },
      // Safe cost parse: handle numbers and strings with '$' symbol
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

    const pipeline = [
      matchStage,
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
            $size: {
              $filter: {
                input: '$projectsSet',
                as: 'pid',
                cond: { $ne: ['$$pid', null] },
              },
            },
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
            $addToSet: {
              $cond: [{ $gt: ['$projects', 0] }, '$user_id', null],
            },
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
              $filter: {
                input: '$users_with_projects',
                as: 'uid',
                cond: { $ne: ['$$uid', null] },
              },
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
      { $sort: { organization_id: 1, user_id: 1, type: 1 } },
    ];

    // Execute pipeline with optional pagination
    let results;
    if (paginate) {
      results = await LLMCost.aggregate([
        ...pipeline,
        { $skip: skip },
        { $limit: limit },
      ]).allowDiskUse(true);
      const totalArr = await LLMCost.aggregate([...pipeline, { $count: 'count' }]);
      const total = totalArr && totalArr[0] ? totalArr[0].count : 0;
      return success(res, results || [], {
        page,
        limit,
        total,
        organization_id: orgId,
      });
    } else {
      results = await LLMCost.aggregate(pipeline).allowDiskUse(true);
      return res.status(200).json(results || []);
    }
  } catch (err) {
    const status = 500;
    return res.status(status).json({
      success: false,
      message: 'Failed to aggregate llm_costs',
      error: err?.message || String(err),
    });
  }
}

module.exports = {
  getLlmCostsAggregated,
};
