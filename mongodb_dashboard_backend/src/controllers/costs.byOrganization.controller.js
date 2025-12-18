'use strict';

const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * getOrganizationUserCosts
 * Controller: GET /api/costs/:organization_id
 * 
 * Returns costs aggregated from the llm_costs collection grouped by organization and user.
 * Stable schema per record:
 *   {
 *     organization_id: string,
 *     organization_name: string|null,
 *     organization_cost: number,
 *     users: number,                  // count of distinct users who created projects (within this org)
 *     user_id: string,
 *     type: string|null,              // best-effort normalized type (type|service_type|operation)
 *     user_cost: number,
 *     projects: number                // number of distinct projects by this user
 *   }
 * 
 * Notes:
 * - Uses robust numeric conversion for total_cost, handling strings like "$0.23".
 * - tenant/org scoping is explicit via path param; JWT/headers may be enforced by upstream middleware.
 * - Uses LLMCost mongoose model which maps to the configured collection (underscore name enforced via env).
 */
async function getOrganizationUserCosts(req, res) {
  try {
    const orgId = String(req.params.organization_id || req.query.organization_id || '').trim();
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'organization_id is required' });
    }

    // Normalize collection name to underscores at runtime if needed via env var for the Mongoose model
    // Ensure process.env.LLMCOSTS_COLLECTION_NAME is 'llm_costs' by default
    if (!process.env.LLMCOSTS_COLLECTION_NAME) {
      // Don't mutate env globally, just rely on the model's current collection
    }

    // Build a robust aggregation:
    // 1) $match organization/tenant variants
    // 2) $project normalized fields: org id/name, user_id string, type, project_id string, total_cost number
    // 3) $group at (org, user, type) to sum user_cost and collect projects
    // 4) $group at org to compute org-level totals and user counts
    // 5) $project final fields
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
            $convert: {
              input: {
                $trim: {
                  input: {
                    $replaceAll: {
                      input: { $toString: '$total_cost' },
                      find: '$',
                      replacement: '',
                    },
                  },
                },
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
        },
      },

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
      // Now compute org-level totals and users count; join back via $lookup-style $group+$project
      {
        $group: {
          _id: '$organization_id',
          organization_name: { $first: '$organization_name' },
          // collect per-user records in an array to post-process organization totals
          records: {
            $push: {
              user_id: '$user_id',
              type: '$type',
              user_cost: '$user_cost',
              projects: '$projects',
            },
          },
          // Compute organization-level cost by summing all user_costs
          organization_cost: { $sum: '$user_cost' },
          // Distinct user count for users that created projects (projects > 0)
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
      // Unwind records back to a flat list with org fields attached
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

    return res.status(200).json({
      success: true,
      data: results || [],
      meta: {
        organization_id: orgId,
        total: Array.isArray(results) ? results.length : 0,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[GET /api/costs/:organization_id] error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Failed to aggregate organization/user costs' });
  }
}

module.exports = {
  getOrganizationUserCosts,
};
