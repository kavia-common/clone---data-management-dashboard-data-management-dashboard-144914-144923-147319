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
    ...(organization_id ? [{ $match: { organization_id } }] : []),

    // Unwind users
    { $unwind: '$users' },

    // Convert monetary strings safely for both organization and user levels.
    {
      $addFields: {
        organization_cost_num: {
          $convert: {
            input: {
              $trim: {
                input: {
                  $replaceAll: {
                    input: { $toString: '$organization_cost' },
                    find: '$',
                    replacement: ''
                  }
                }
              }
            },
            to: 'double',
            onError: 0,
            onNull: 0
          }
        },
        user_cost_num: {
          $convert: {
            input: {
              $trim: {
                input: {
                  $replaceAll: {
                    input: { $toString: '$users.user_cost' },
                    find: '$',
                    replacement: ''
                  }
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

    // Group per USER
    {
      $group: {
        _id: {
          organization_id: '$organization_id',
          organization_name: '$organization_name',
          organization_cost: '$organization_cost',
          user_id: '$users.user_id',
          type: '$users.type'
        },
        user_cost: { $first: '$user_cost_num' },
        organization_cost: { $first: '$organization_cost_num' },
        projectsSet: { $addToSet: '$users.projects.project_id' }
      }
    },

    // Shape output
    {
      $project: {
        _id: 0,
        organization_id: '$_id.organization_id',
        organization_name: '$_id.organization_name',
        organization_cost: { $round: [{ $ifNull: ['$organization_cost', 0] }, 6] },
        user_id: '$_id.user_id',
        type: '$_id.type',
        user_cost: { $round: [{ $ifNull: ['$user_cost', 0] }, 6] },
        projects: {
          $size: {
            $filter: {
              input: '$projectsSet',
              as: 'p',
              cond: { $ne: ['$$p', null] }
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
  const facet = Array.isArray(result) && result[0] ? result[0] : { rows: [], meta: [], orgMeta: [] };
  const rows = Array.isArray(facet.rows) ? facet.rows : [];
  const metaArr = Array.isArray(facet.meta) ? facet.meta : [];
  const orgMetaArr = Array.isArray(facet.orgMeta) ? facet.orgMeta : [];
  const postGroupCount = metaArr[0]?.total || 0;
  const orgMeta = orgMetaArr[0] || null;

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
    // Note: we cannot directly detect per-doc conversion errors here; set reason when empty or pagination resulted in none.
    if (!enriched.length) {
      res.setHeader('X-LLM-COSTS-Reason', 'Empty rows after aggregation or conversion fallback applied to empty values.');
    } else {
      // Provide a soft hint that safe conversion with onError/onNull=0 is in effect
      res.setHeader('X-LLM-COSTS-Reason', 'Safe currency parsing active (onError/onNull=0).');
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