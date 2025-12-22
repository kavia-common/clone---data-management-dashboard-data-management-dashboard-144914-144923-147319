'use strict';

const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

async function getOrganizationUserCosts(req, res) {
  try {
    const orgId = String(req.params.organization_id || req.query.organization_id || '').trim();
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'organization_id is required' });
    }

    const pipeline = [
      {
        $match: {
          $or: [
            { organization_id: orgId },
            { tenant_id: orgId },
            { org_id: orgId },
            { tenantId: orgId },
          ],
        },
      },
      {
        $project: {
          organization_id: {
            $ifNull: [
              '$organization_id',
              { $ifNull: ['$tenant_id', { $ifNull: ['$org_id', '$tenantId'] }] },
            ],
          },
          organization_name: { $ifNull: ['$organization_name', null] },
          user_id: { $toString: '$user_id' },
          type: { $ifNull: ['$type', { $ifNull: ['$service_type', '$operation'] }] },
          project_id: { $cond: [{ $ne: ['$project_id', null] }, { $toString: '$project_id' }, null] },
          total_cost_num: {
            $convert: {
              input: {
                $trim: {
                  input: { $replaceAll: { input: { $toString: '$total_cost' }, find: '$', replacement: '' } },
                },
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
          agents: 1, // include agents array
        },
      },
      // Unwind agents to normalize them
      { $unwind: { path: '$agents', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          organization_id: 1,
          organization_name: 1,
          user_id: 1,
          type: 1,
          project_id: 1,
          total_cost_num: 1,
          agent_name: '$agents.agent_name',
          agent_cost: {
            $convert: {
              input: {
                $trim: { input: { $replaceAll: { input: { $toString: '$agents.total_cost' }, find: '$', replacement: '' } } },
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
        },
      },
      // Group back by user + project + type, collecting agents into an array
      {
        $group: {
          _id: {
            organization_id: '$organization_id',
            organization_name: '$organization_name',
            user_id: '$user_id',
            type: '$type',
            project_id: '$project_id',
          },
          user_cost: { $sum: '$total_cost_num' },
          agents: {
            $push: {
              agent_name: '$agent_name',
              agent_cost: '$agent_cost',
            },
          },
        },
      },
      // Group by organization + user + type to compute totals per user
      {
        $group: {
          _id: {
            organization_id: '$_id.organization_id',
            organization_name: '$_id.organization_name',
            user_id: '$_id.user_id',
            type: '$_id.type',
          },
          user_cost: { $sum: '$user_cost' },
          projects: {
            $push: {
              project_id: '$_id.project_id',
              agents: '$agents',
            },
          },
        },
      },
      // Group by organization to compute org-level totals
      {
        $group: {
          _id: '$_id.organization_id',
          organization_name: { $first: '$_id.organization_name' },
          organization_cost: { $sum: '$user_cost' },
          users_with_projects: { $addToSet: '$_id.user_id' },
          records: {
            $push: {
              user_id: '$_id.user_id',
              type: '$_id.type',
              user_cost: '$user_cost',
              projects: '$projects',
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          organization_id: '$_id',
          organization_name: 1,
          organization_cost: { $round: ['$organization_cost', 6] },
          users: { $size: '$users_with_projects' },
          records: 1,
        },
      },
      { $unwind: '$records' },
      {
        $project: {
          organization_id: 1,
          organization_name: 1,
          organization_cost: 1,
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

    return res.status(200).json({
      success: true,
      data: results || [],
      meta: {
        organization_id: orgId,
        total: Array.isArray(results) ? results.length : 0,
      },
    });
  } catch (err) {
    console.error('[GET /api/costs/:organization_id] error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Failed to aggregate organization/user costs' });
  }
}

module.exports = {
  getOrganizationUserCosts,
};
