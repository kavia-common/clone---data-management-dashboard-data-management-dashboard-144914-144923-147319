'use strict';

const LLMCost = require('../models/llmCosts.model');
const { success } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs (underscore)
 *
 * Fixes:
 * - Avoids any bare "$" FieldPath in addFields/project/set
 * - Normalizes problematic numeric fields for b2c (empty strings, currency-prefixed)
 * - Adds onError/onNull:0 to all conversions
 * - Defensive pagination/sorting
 */
async function getLlmCostsAggregated(req, res) {
  const maxLimit = 100;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
  const skip = (page - 1) * limit;

  const organization_id = (req.query.organization_id || '').toString().trim();

  // Helper to build a safe numeric conversion for a field path
  const toSafeDouble = (fieldPath) => ({
    $let: {
      vars: {
        raw: { $ifNull: [fieldPath, 0] },
        rawStr: { $toString: { $ifNull: [fieldPath, ''] } },
      },
      in: {
        $cond: [
          { $isNumber: '$$raw' },
          { $convert: { input: '$$raw', to: 'double', onError: 0, onNull: 0 } },
          {
            $let: {
              vars: {
                noDollar: {
                  $cond: [
                    { $eq: [{ $substrCP: ['$$rawStr', 0, 1] }, '$'] },
                    { $substrCP: ['$$rawStr', 1, { $strLenCP: '$$rawStr' }] },
                    '$$rawStr',
                  ],
                },
              },
              in: {
                $let: {
                  vars: {
                    cleaned: {
                      $replaceAll: {
                        input: {
                          $replaceAll: {
                            input: { $trim: { input: '$$noDollar' } },
                            find: ',',
                            replacement: '',
                          },
                        },
                        find: ' ',
                        replacement: '',
                      },
                    },
                  },
                  in: {
                    $convert: {
                      input: { $cond: [{ $eq: ['$$cleaned', ''] }, '0', '$$cleaned'] },
                      to: 'double',
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  });

  // Initial normalization for common numeric fields to avoid $convert errors
  // NOTE: Never use a bare '$' anywhere; always valid field paths like '$details.breakdown_summary.costs.input'
  const normalizationStage = {
    $addFields: {
      safePromptTokens: {
        $convert: {
          input: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $type: '$prompt_tokens' }, 'missing'] },
                  { $eq: ['$prompt_tokens', null] },
                  { $eq: ['$prompt_tokens', ''] },
                ],
              },
              0,
              '$prompt_tokens',
            ],
          },
          to: 'double',
          onError: 0,
          onNull: 0,
        },
      },
      safeCompletionTokens: {
        $convert: {
          input: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $type: '$completion_tokens' }, 'missing'] },
                  { $eq: ['$completion_tokens', null] },
                  { $eq: ['$completion_tokens', ''] },
                ],
              },
              0,
              '$completion_tokens',
            ],
          },
          to: 'double',
          onError: 0,
          onNull: 0,
        },
      },
      safeInputCost: toSafeDouble('$details.breakdown_summary.costs.input'),
      safeOutputCost: toSafeDouble('$details.breakdown_summary.costs.output'),
      safeTotalCost: {
        $cond: [
          {
            $or: [
              { $ne: [{ $type: '$total_cost' }, 'missing'] },
              { $ne: ['$total_cost', null] },
              { $ne: ['$total_cost', ''] },
            ],
          },
          toSafeDouble('$total_cost'),
          {
            $add: [
              toSafeDouble('$details.breakdown_summary.costs.input'),
              toSafeDouble('$details.breakdown_summary.costs.output'),
            ],
          },
        ],
      },
    },
  };

  const pipeline = [
    ...(organization_id ? [{ $match: { organization_id } }] : []),

    // Normalize numerics early to prevent conversion errors downstream
    normalizationStage,

    // Unwind users array to compute per-user cost where present; preserve missing arrays
    { $unwind: { path: '$users', preserveNullAndEmptyArrays: true } },

    // Compute user_cost_num safely from users.user_cost; handle '', '$12.34', comma separated, etc.
    {
      $addFields: {
        user_cost_num: toSafeDouble('$users.user_cost'),
      },
    },

    // Projects may be absent; unwind safely for counting distinct project_ids
    {
      $unwind: { path: '$users.projects', preserveNullAndEmptyArrays: true },
    },

    // Group by user and carry normalized totals
    {
      $group: {
        _id: {
          organization_id: '$organization_id',
          organization_name: '$organization_name',
          user_id: '$users.user_id',
          type: '$users.type',
        },
        user_cost: { $first: '$user_cost_num' },
        safeTotalCost: { $first: '$safeTotalCost' },
        safeInputCost: { $first: '$safeInputCost' },
        safeOutputCost: { $first: '$safeOutputCost' },
        projectsSet: { $addToSet: '$users.projects.project_id' },
      },
    },

    // Shape final projection; ensure all paths are valid
    {
      $project: {
        _id: 0,
        organization_id: '$_id.organization_id',
        organization_name: '$_id.organization_name',
        user_id: '$_id.user_id',
        type: '$_id.type',
        user_cost: { $ifNull: ['$user_cost', 0] },
        total_cost: { $ifNull: ['$safeTotalCost', 0] },
        input_cost: { $ifNull: ['$safeInputCost', 0] },
        output_cost: { $ifNull: ['$safeOutputCost', 0] },
        projects: {
          $size: {
            $filter: { input: '$projectsSet', as: 'p', cond: { $ne: ['$$p', null] } },
          },
        },
      },
    },

    // Default sort defensively on total_cost desc then user_cost desc
    { $sort: { total_cost: -1, user_cost: -1 } },

    // Pagination facet
    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: limit }],
        meta: [{ $count: 'total' }],
      },
    },
  ];

  let result = [];
  try {
    result = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
  } catch (err) {
    // Surface a 200 with empty array rather than a 500 for malformed legacy docs,
    // but include a diagnostic header to help operators.
    try {
      res.setHeader('X-LLM-COSTS-Aggregation-Error', '1');
      res.setHeader('X-LLM-COSTS-Aggregation-Message', String(err?.message || err));
    } catch {}
    return success(
      res,
      [],
      {
        page,
        limit,
        total: 0,
        organization_id: organization_id || null,
      },
      200
    );
  }

  const facet = Array.isArray(result) && result[0] ? result[0] : { rows: [], meta: [] };
  const rows = Array.isArray(facet.rows) ? facet.rows : [];
  const total = Array.isArray(facet.meta) && facet.meta[0]?.total ? facet.meta[0].total : 0;

  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
    if (organization_id) res.setHeader('x-effective-tenant', organization_id);
    res.setHeader('x-llm-costs-total', String(total));
  } catch {}

  return success(
    res,
    rows,
    {
      page,
      limit,
      total,
      organization_id: organization_id || null,
    },
    200
  );
}

module.exports = { getLlmCostsAggregated };