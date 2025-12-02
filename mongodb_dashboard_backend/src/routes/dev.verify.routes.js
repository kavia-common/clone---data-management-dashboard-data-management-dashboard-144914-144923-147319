'use strict';

const express = require('express');
const router = express.Router();
const { verifyLlmCosts } = require('../controllers/dev.verify.llmCosts.controller');

// PUBLIC_INTERFACE
/**
 * GET /api/dev/verify-llm-costs
 * Summary: Development-only helper to verify latency and headers of /api/llm-costs.
 * Description:
 *  - Proxies a call to /api/llm-costs with provided tenant and pagination parameters.
 *  - Measures server-side latency (target < 2000 ms).
 *  - Captures diagnostic headers and minimal body meta for UI table field verification.
 *  - Falls back to /api/llm-costs/diagnostics/last when 5xx/504 occurs.
 * Query:
 *  - organization_id or tenant_id (or header x-organization-id), page, limit, sort, from, to, filter
 * Returns: { success, status, latencyMs, headers, bodyMeta, diagnosticsLast }
 */
router.get('/verify-llm-costs', verifyLlmCosts);

module.exports = router;
