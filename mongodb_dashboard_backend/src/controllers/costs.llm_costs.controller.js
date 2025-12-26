'use strict';

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs (underscore)
 *
 * Restored previous working behavior: simple list with pagination and optional tenant filter.
 * Minimal b2c-only fix: if organization_id === 'b2c', run a guarded aggregation
 * that safely converts numeric-like fields without altering global filtering/sorting logic.
 */
const LLMCost = require('../models/llmCosts.model');
const { success } = require('../utils/http');

async function getLlmCostsAggregated(req, res) {
  const maxLimit = 100;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
  const skip = (page - 1) * limit;

  const organization_id = (req.query.organization_id || '').toString().trim();

  // For all orgs except b2c, restore original behavior: raw find with simple org filter and pagination
  if (organization_id && organization_id !== 'b2c') {
    const filter = { $or: [{ organization_id }, { tenant_id: organization_id }] };
    const sort = { _id: -1 };
    let total = 0;
    let docs = [];
    try {
      [total, docs] = await Promise.all([
        LLMCost.countDocuments(filter),
        LLMCost.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
      ]);
    } catch (err) {
      return success(
        res,
        [],
        { page, limit, total: 0, organization_id: organization_id || null, error: String(err?.message || err) },
        200
      );
    }
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Total', String(total));
      res.setHeader('x-effective-tenant', organization_id);
    } catch {}
    return success(res, docs, { page, limit, total, organization_id }, 200);
  }

  // For no org provided, behave like prior: list without tenant filter (demo use), simple sort/pagination
  if (!organization_id) {
    const sort = { _id: -1 };
    let total = 0;
    let docs = [];
    try {
      [total, docs] = await Promise.all([
        LLMCost.countDocuments({}),
        LLMCost.find({}).sort(sort).skip(skip).limit(limit).lean().exec(),
      ]);
    } catch (err) {
      return success(res, [], { page, limit, total: 0, organization_id: null, error: String(err?.message || err) }, 200);
    }
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Total', String(total));
    } catch {}
    return success(res, docs, { page, limit, total, organization_id: null }, 200);
  }

  // Minimal, targeted b2c aggregation with safe numeric conversions and valid field paths only.
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

  const pipeline = [
    { $match: { $or: [{ organization_id: 'b2c' }, { tenant_id: 'b2c' }] } },
    {
      $addFields: {
        // Only guard known problematic numeric fields; do not change filtering/sorting/pagination globally
        safe_total_cost: toSafeDouble('$total_cost'),
        safe_input_cost: toSafeDouble('$details.breakdown_summary.costs.input'),
        safe_output_cost: toSafeDouble('$details.breakdown_summary.costs.output'),
        safe_prompt_tokens: {
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
            to: 'int',
            onError: 0,
            onNull: 0,
          },
        },
        safe_completion_tokens: {
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
            to: 'int',
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    // Project raw doc plus safe fields appended for clients that rely on them
    {
      $project: {
        _id: 1,
        request_id: 1,
        session_id: 1,
        project_id: 1,
        timestamp: 1,
        created_at: 1,
        model: 1,
        model_version: 1,
        provider: 1,
        provider_status: 1,
        user_id: 1,
        organization_id: 1,
        tenant_id: 1,
        users: 1,
        details: 1,
        status: 1,
        total_cost: 1,
        'details.breakdown_summary.costs.input': 1,
        'details.breakdown_summary.costs.output': 1,
        prompt_tokens: 1,
        completion_tokens: 1,

        // safe derivations
        safe_total_cost: 1,
        safe_input_cost: 1,
        safe_output_cost: 1,
        safe_prompt_tokens: 1,
        safe_completion_tokens: 1,
      },
    },
    { $sort: { _id: -1 } },
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
    try {
      res.setHeader('X-LLM-COSTS-Aggregation-Error', '1');
      res.setHeader('X-LLM-COSTS-Aggregation-Message', String(err?.message || err));
    } catch {}
    return success(res, [], { page, limit, total: 0, organization_id: 'b2c' }, 200);
  }

  const facet = Array.isArray(result) && result[0] ? result[0] : { rows: [], meta: [] };
  const rows = Array.isArray(facet.rows) ? facet.rows : [];
  const total = Array.isArray(facet.meta) && facet.meta[0]?.total ? facet.meta[0].total : 0;

  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
    res.setHeader('X-LLM-COSTS-Total', String(total));
    res.setHeader('x-effective-tenant', 'b2c');
  } catch {}

  return success(res, rows, { page, limit, total, organization_id: 'b2c' }, 200);
}

module.exports = { getLlmCostsAggregated };