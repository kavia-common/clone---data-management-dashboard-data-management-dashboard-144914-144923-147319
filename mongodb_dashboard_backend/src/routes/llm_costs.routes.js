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
 *   - organization_id (string): required for filtering; supports case-insensitive fallback against tenant/org variants
 *
 * Fields in each row:
 *   - organization_id
 *   - organization_name
 *   - organization_cost (sum of user_cost across org)
 *   - users (count of distinct users who created projects)
 *   - user_id
 *   - type
 *   - user_cost (per user)
 *   - projects (count of projects per user)
 */
const router = express.Router();

/**
 * Build aggregation pipeline to:
 *  (a) $match by organization_id (case-insensitive fallback)
 *  (b) group by {organization_id, organization_name, user_id, type} to compute user_cost and projects per user
 *  (c) compute organization aggregates including organization_cost and users count
 *  (d) return a flat array including org-level fields on each user row
 */
async function handler(req, res) {
  const orgId = String(req.query.organization_id || '').trim();
  if (!orgId) {
    return failure(res, 'organization_id query parameter is required', 400);
  }

  // robust $match that tries aliases and allows case-insensitive equality on main keys
  const matchStage = {
    $match: {
      $or: [
        { organization_id: orgId },
        { tenant_id: orgId },
        { org_id: orgId },
        { tenantId: orgId },
        { organization_id: { $regex: `^${orgId}$`, $options: 'i' } },
        { tenant_id: { $regex: `^${orgId}$`, $options: 'i' } },
      ],
    },
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
    // Convert total_cost safely to double, removing $ when string
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

  const results = await LLMCost.aggregate(pipeline).allowDiskUse(true);
  return success(
    res,
    results || [],
    { organization_id: orgId, total: Array.isArray(results) ? results.length : 0 },
    200
  );
}

router.get('/', asyncHandler(handler));

module.exports = router;
