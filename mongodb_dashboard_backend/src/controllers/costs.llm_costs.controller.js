'use strict';

const LLMCost = require('../models/llmCosts.model');
const { success } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs
 *
 * Implements minimal nested-array aggregation per spec:
 * - Matches optional organization_id
 * - Sums users[].user_cost with numeric coercion
 * - Counts users and projects arrays safely
 * - Pagination with sane defaults and cap
 * - Diagnostics headers
 */
async function getLlmCostsAggregated(req, res) {
  const MAX_LIMIT = 100;
  const pageRaw = parseInt(req.query.page, 10);
  const limitRaw = parseInt(req.query.limit, 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : 10;
  const skip = (page - 1) * limit;

  const organization_id = (req.query.organization_id || '').toString().trim();
  const match = organization_id ? { organization_id } : {};

  const pipeline = [
    { $match: match },
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
            in: {
              $add: [
                '$$value',
                {
                  $cond: [
                    { $ne: [{ $type: '$$this.user_cost' }, 'missing'] },
                    {
                      $cond: [
                        { $in: [{ $type: '$$this.user_cost' }, ['double', 'int', 'long', 'decimal']] },
                        { $toDouble: '$$this.user_cost' },
                        {
                          $cond: [
                            { $eq: [{ $type: '$$this.user_cost' }, 'string'] },
                            {
                              $toDouble: {
                                $replaceAll: {
                                  input: { $trim: { input: '$$this.user_cost' } },
                                  find: '$',
                                  replacement: '',
                                },
                              },
                            },
                            0,
                          ],
                        },
                      ],
                    },
                    0,
                  ],
                },
              ],
            },
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
        organization_cost: { $round: ['$organization_cost', 6] },
        users: 1,
        projects: 1,
        cost: { $round: ['$organization_cost', 6] },
        _mode: { $literal: 'nested' },
      },
    },
    { $sort: { organization_cost: -1, organization_id: 1 } },
    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: limit }],
        meta: [{ $count: 'total' }],
      },
    },
  ];

  const [facet] = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
  const rows = (facet && Array.isArray(facet.rows)) ? facet.rows : [];
  const total = (facet && Array.isArray(facet.meta) && facet.meta[0]?.total) ? facet.meta[0].total : 0;

  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
    res.setHeader('X-LLM-COSTS-Mode', 'nested');
    res.setHeader('X-LLM-COSTS-MatchedPreGroup', JSON.stringify(match));
    res.setHeader('X-LLM-COSTS-PostGroupCount', String(total));
    if (rows.length === 0) {
      res.setHeader('X-LLM-COSTS-Reason', 'No results for nested users shape or filter.');
    }
  } catch {}

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
}

module.exports = { getLlmCostsAggregated };
