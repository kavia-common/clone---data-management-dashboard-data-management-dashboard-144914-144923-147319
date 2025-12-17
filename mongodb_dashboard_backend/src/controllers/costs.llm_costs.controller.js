'use strict';

const LLMCost = require('../models/llmCosts.model');
const { success } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * getLlmCostsAggregated
 * Controller for GET /api/llm_costs
 *
 * Purpose:
 * Provide a stable, tabular list of LLM cost records from the 'llm_costs' collection with:
 * - Optional filter by organization_id (string match)
 * - Pagination with defaults page=1, limit=10 (clamped to max 100)
 * - Stable default sort by _id desc
 * - Diagnostics headers with collection name and totals
 *
 * This implementation intentionally avoids assuming nested 'users' or 'projects' arrays to be
 * compatible with the canonical flat llm_costs schema used by the rest of the app.
 */
async function getLlmCostsAggregated(req, res) {
  // Pagination with sane defaults and clamped max
  const maxLimit = 100;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
  const skip = (page - 1) * limit;

  // Optional exact filter by organization_id
  const organization_id = (req.query.organization_id || '').toString().trim();
  const filter = {};
  if (organization_id) {
    filter.organization_id = organization_id;
  }

  // Stable default sort: newest first by _id
  const sort = { _id: -1 };

  // Execute count + page using Mongoose model (mapped to 'llm_costs' by default)
  const [total, docs] = await Promise.all([
    LLMCost.countDocuments(filter),
    LLMCost.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
  ]);

  // Minimal diagnostic headers (collection name and total)
  try {
    res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
    res.setHeader('X-LLM-COSTS-Total', String(total));
    if (!docs?.length) {
      res.setHeader('X-LLM-COSTS-Reason', 'No documents matched filter');
    }
  } catch {}

  // Envelope response
  return success(
    res,
    Array.isArray(docs) ? docs : [],
    {
      page,
      limit,
      total,
      ...(organization_id ? { organization_id } : {}),
    },
    200
  );
}

module.exports = { getLlmCostsAggregated };
