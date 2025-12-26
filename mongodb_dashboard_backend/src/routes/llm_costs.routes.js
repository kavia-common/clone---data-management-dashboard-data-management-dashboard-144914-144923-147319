'use strict';

const express = require('express');
const LLMCost = require('../models/llmCosts.model');
const { asyncHandler, success } = require('../utils/http');
const { deriveAgentName } = require('../utils/agentName');

const router = express.Router();

/**
 * escapeRegex
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const maxLimit = 100;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
    const skip = (page - 1) * limit;

    const rawOrg = (req.query.organization_id || req.query.tenant_id || '').toString().trim();
    const filter = {};

    if (rawOrg) {
      const rx = new RegExp(`^${escapeRegex(rawOrg)}$`, 'i');
      filter.$or = [
        { organization_id: rawOrg },
        { organization_id: { $regex: rx } },
        { tenant_id: rawOrg },
        { tenant_id: { $regex: rx } },
      ];
    }

    const sort = { _id: -1 };

    const [total, rawDocs] = await Promise.all([
      LLMCost.countDocuments(filter),
      LLMCost.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
    ]);

    const docs = Array.isArray(rawDocs)
      ? rawDocs.map((d) => {
          try {
            const agent_name = deriveAgentName(d);
            return { ...d, agent_name: agent_name ?? null };
          } catch {
            return { ...d, agent_name: null };
          }
        })
      : [];

    try {
      res.setHeader(
        'X-LLM-COSTS-Collection',
        LLMCost.collection?.collectionName || 'llm_costs'
      );
      res.setHeader('X-LLM-COSTS-Total', String(total));
    } catch {}

    return success(
      res,
      docs,
      {
        page,
        limit,
        total,
        ...(rawOrg ? { organization_id: rawOrg } : {}),
      },
      200
    );
  })
);

module.exports = router;
