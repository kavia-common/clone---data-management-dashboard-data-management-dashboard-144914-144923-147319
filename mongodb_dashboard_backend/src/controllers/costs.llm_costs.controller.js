'use strict';

const LLMCost = require('../models/llmCosts.model'); // corrected path two-level up not needed; file resides in src/models
const { success } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs
 *
 * Implements a minimal, safe, and verifiable pipeline.
 * - Optional organization_id filter (?organization_id)
 * - Pagination with defaults page=1, limit=10 (clamped to max 100)
 * - No malformed field paths: no stage contains a field path that is just '$'
 * - Adds diagnostics headers
 */
async function getLlmCostsAggregated(req, res) {
  // Parse pagination with clamping
  const maxLimit = 100;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
  const skip = (page - 1) * limit;

  // Optional filter
  const organization_id = (req.query.organization_id || '').toString().trim();
  const matchStage = organization_id
    ? { $match: { organization_id: organization_id } }
    : { $match: {} };

  // Build the minimal pipeline per spec
  const pipeline = [
    // Tenant/organization scope — accept any string id (non-numeric such as 'b2c')
    ...(organization_id ? [{ $match: { organization_id } }] : []),

    // Normalize cost fields defensively before arithmetic: treat '', null, undefined, and non-numeric as 0.
    // We first strip a leading '$' when present, then attempt numeric conversion with onError/onNull: 0.
    {
      $addFields: {
        // Common total_cost normalization at top-level documents (if present in schema variants)
        total_cost_num: {
          $convert: {
            input: {
              $cond: [
                { $and: [{ $isArray: '$total_cost' }, { $gt: [{ $size: '$total_cost' }, 0] }] },
                { $arrayElemAt: ['$total_cost', 0] },
                '$total_cost',
              ]
            },
            to: 'double',
            onError: 0,
            onNull: 0,
          }
        },
      }
    },

    // Unwind users (documents may have nested user breakdowns)
    { $unwind: { path: '$users', preserveNullAndEmptyArrays: true } },

    // Convert user_cost safely. Supports values like '$1.23', '1.23', '', null -> 0
    {
      $addFields: {
        user_cost_num: {
          $convert: {
            input: {
              $let: {
                vars: {
                  raw: { $ifNull: ['$users.user_cost', 0] },
                },
                in: {
                  $cond: [
                    { $eq: [{ $type: '$$raw' }, 'string'] },
                    {
                      $trim: {
                        input: {
                          $cond: [
                            { $eq: [{ $substrCP: ['$$raw', 0, 1] }, '$'] },
                            { $substrCP: ['$$raw', 1, { $subtract: [{ $strLenCP: '$$raw' }, 1] }] },
                            '$$raw'
                          ]
                        }
                      }
                    },
                    '$$raw'
                  ]
                }
              }
            },
            to: 'double',
            onError: 0,
            onNull: 0
          }
        }
      }
    },

    // Unwind projects (optional but needed for count)
    {
      $unwind: {
        path: '$users.projects',
        preserveNullAndEmptyArrays: true
      }
    },

    // Group per USER with safe accumulation
    {
      $group: {
        _id: {
          organization_id: '$organization_id',
          organization_name: '$organization_name',
          organization_cost: '$organization_cost',
          user_id: '$users.user_id',
          type: '$users.type'
        },
        // choose the first normalized cost for the user in this doc (or could change to sum if duplicates appear)
        user_cost: { $first: { $ifNull: ['$user_cost_num', 0] } },
        // Projects may store id or project_id; collect either when present
        projectsSet: {
          $addToSet: {
            $ifNull: [
              { $ifNull: ['$users.projects.project_id', '$users.projects.id'] },
              null
            ]
          }
        }
      }
    },

    // Shape output with safe counts
    {
      $project: {
        _id: 0,
        organization_id: '$_id.organization_id',
        organization_name: '$_id.organization_name',
        organization_cost: '$_id.organization_cost',
        user_id: '$_id.user_id',
        type: '$_id.type',
        user_cost: 1,
        projects: {
          $size: {
            $filter: {
              input: '$projectsSet',
              as: 'p',
              cond: { $and: [{ $ne: ['$$p', null] }, { $ne: ['$$p', ''] }] }
            }
          }
        }
      }
    },

    { $sort: { user_cost: -1 } },

    // Pagination + meta
    {
      $facet: {
        rows: [{ $skip: skip }, { $limit: limit }],
        meta: [{ $count: 'total' }]
      }
    }
  ];


  // Execute
  const result = await LLMCost.aggregate(pipeline, { allowDiskUse: true });
  const facet = Array.isArray(result) && result[0] ? result[0] : { rows: [], meta: [] };
  const rows = Array.isArray(facet.rows) ? facet.rows : [];
  const metaArr = Array.isArray(facet.meta) ? facet.meta : [];
  const postGroupCount = metaArr[0]?.total || 0;

  // Enrich rows with org-level info when available
  // const enriched = rows.map((r) => {
  //   if (orgMeta) {
  //     return {
  //       ...r,
  //       organization_cost: orgMeta.organization_cost ?? 0,
  //       users: orgMeta.users ?? 0,
  //     };
  //   }
  //   return { ...r, organization_cost: 0, users: 0 };
  // });
  const enriched = rows;


  // Diagnostics headers
  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
    // Matched pre-group docs requires separate count; keep lightweight by echoing filter only
    res.setHeader('X-LLM-COSTS-MatchedPreGroup', JSON.stringify(matchStage?.$match || {}));
    res.setHeader('X-LLM-COSTS-PostGroupCount', String(postGroupCount));
    if (!enriched.length) {
      res.setHeader('X-LLM-COSTS-Reason', 'Empty rows after aggregation.');
    }
  } catch { }

  // Response shape with pagination meta
  return success(
    res,
    enriched,
    {
      page,
      limit,
      total: postGroupCount,
      organization_id: organization_id || null,
    },
    200
  );
}

module.exports = { getLlmCostsAggregated };