'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
// LLMCost model
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * Minimal sample/probe route for LLM costs.
 * GET /api/llm-costs/sample
 * - Accepts organization_id or tenant_id via query (or header x-organization-id) when JWT is not present.
 * - Resolves effective tenant using requireTenant middleware and returns one sample document for quick liveness checks.
 * - Adds diagnostic headers:
 *    X-Applied-Filter: JSON of the effective filter applied
 *    X-Applied-Tenant-Field: which tenant field alias matched (or fallback guess)
 *    X-Model-Collection: target collection name
 * - This endpoint is optimized to be fast and constrained, to avoid heavy scans/timeouts for health probes.
 */
const router = express.Router();

// Apply auth+tenant resolution but allow header/query tenant when no JWT (handled inside requireTenant)
router.use(verifyAuth, requireTenant);

router.get(
  '/sample',
  asyncHandler(async (req, res) => {
    // Early header flush/heartbeat to keep upstream proxy alive if DB is slow
    try {
      if (!res.headersSent) {
        res.set('Cache-Control', 'no-store');
        res.set('X-Route', '/api/llm-costs/sample');
        res.set('X-Stream-Preamble', 'true');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.write(' ');
      }
    } catch (_) {}

    // Determine tenant and construct a precise candidate filter by probing each tenant alias
    const tenant = req.tenantId ? String(req.tenantId) : '';
    const candidates = tenant
      ? [
          { tenant_id: tenant },
          { organization_id: tenant },
          { orgId: tenant },
          { tenantId: tenant },
          { organizationId: tenant },
          { 'tenant.tenant_id': tenant },
        ]
      : [{}];

    let applied = candidates[0] || {};
    let matchedField = null;

    for (const c of candidates) {
      try {
        const doc = await LLMCost.findOne(c).select({ _id: 1 }).lean();
        if (doc && doc._id) {
          applied = c;
          matchedField = Object.keys(c)[0] || null;
          break;
        }
      } catch {
        // ignore and continue
      }
    }

    try {
      res.set('X-Applied-Filter', JSON.stringify(applied));
      res.set('X-Applied-Tenant-Field', matchedField || (applied.$or ? 'tenant_id|organization_id' : 'unknown'));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
    } catch (_) {}

    // Fetch one sample document using the applied filter; sort by recent timestamp to keep it deterministic
    // Also coerce timestamp for consistency
    let sample = null;
    try {
      sample = await LLMCost.findOne(applied).sort({ timestamp: -1, created_at: -1, _id: -1 }).lean();
    } catch (_) {
      // fallback without sort if projection fails in some environments
      try {
        sample = await LLMCost.findOne(applied).lean();
      } catch {}
    }

    if (!sample) {
      return res.status(200).json({ success: true, sample: null, hint: 'No document matched current tenant scope.' });
    }

    // Normalize timestamp field for clients
    if (!sample.timestamp && sample.created_at) {
      sample.timestamp = sample.created_at;
    }

    return res.status(200).json({ success: true, sample });
  })
);

module.exports = router;
