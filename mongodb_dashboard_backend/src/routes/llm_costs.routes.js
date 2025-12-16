'use strict';

const express = require('express');
const LLMCost = require('../models/llmCosts.model');
const { asyncHandler, success, failure } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * Router for GET /api/llm_costs
 *
 * Returns one row per user including organization-level aggregates on each row.
 * Query:
 *   - organization_id (string): optional for filtering; supports case-insensitive fallback against tenant/org variants
 *   - page, limit: pagination; applied after sort
 *
 * Response fields per row:
 *   - organization_id
 *   - organization_name
 *   - organization_cost (sum of user_cost across org)
 *   - users (count of distinct users with projects in the org)
 *   - user_id
 *   - type
 *   - user_cost
 *   - projects (count)
 *
 * Headers (temporary diagnostics):
 *   - X-LLM-COSTS-Collection
 *   - X-LLM-COSTS-Pipeline
 *   - X-LLM-COSTS-Matched
 */
const router = express.Router();

// PUBLIC_INTERFACE
async function handler(req, res) {
  // pagination
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const skip = (page - 1) * limit;

  // org filter (optional). If provided, exact match with case-insensitive fallback on aliases.
  const orgIdRaw = (req.query.organization_id || req.query.tenant_id || '').toString().trim();
  const hasOrg = !!orgIdRaw;

  const match = {};
  if (hasOrg) {
    match.$or = [
      { organization_id: orgIdRaw },
      { tenant_id: orgIdRaw },
      { org_id: orgIdRaw },
      { tenantId: orgIdRaw },
      { organization_id: { $regex: `^${orgIdRaw}$`, $options: 'i' } },
      { tenant_id: { $regex: `^${orgIdRaw}$`, $options: 'i' } },
    ];
  }

  // normalization projection; ensure no naked "$" field paths
  const projectNormalized = {
    organization_id: {
      $ifNull: [
        '$organization_id',
        { $ifNull: ['$tenant_id', { $ifNull: ['$org_id', '$tenantId'] }] },
      ],
    },
    organization_name: { $ifNull: ['$organization_name', null] },
    user_id: {
      $cond: [
        { $ne: ['$user_id', null] },
        { $toString: '$user_id' },
        null,
      ],
    },
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

  const pipeline = [];
  if (hasOrg) pipeline.push({ $match: match });
  pipeline.push(
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
    { $sort: { organization_id: 1, user_id: 1, type: 1 } }
  );

  // diagnostics headers
  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection.collectionName || 'llm_costs');
    res.setHeader('X-LLM-COSTS-Pipeline', JSON.stringify(pipeline));
    res.setHeader('X-LLM-COSTS-Matched', hasOrg ? JSON.stringify(match) : '{}');
  } catch (_) {}

  // execute with pagination after sort
  const paginated = await LLMCost.aggregate([
    ...pipeline,
    { $skip: skip },
    { $limit: limit },
  ]).allowDiskUse(true);

  // total count for meta (count number of flattened rows)
  const totalArr = await LLMCost.aggregate([...pipeline, { $count: 'count' }]);
  const total = totalArr && totalArr[0] ? totalArr[0].count : 0;

  return success(
    res,
    paginated || [],
    {
      page,
      limit,
      total,
      organization_id: hasOrg ? orgIdRaw : null,
    },
    200
  );
}

router.get('/', asyncHandler(handler));

module.exports = router;
