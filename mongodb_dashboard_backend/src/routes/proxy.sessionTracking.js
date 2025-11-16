const express = require('express');
const axios = require('axios');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/proxy/session-tracking
 * Proxies requests to the upstream session-tracking service.
 * Query params: page, limit, tenant_id, sort, filter, q, pageSize
 * Returns upstream JSON as-is; on error, returns { proxy: 'session-tracking', ...upstreamError } with status from upstream or 502.
 */
router.get('/session-tracking', async (req, res) => {
  try {
    const { page, limit, tenant_id, sort, filter, q, pageSize } = req.query;
    const params = new URLSearchParams();
    if (page) params.set('page', page);
    if (limit) params.set('limit', limit);
    if (tenant_id) params.set('tenant_id', tenant_id);
    if (sort) params.set('sort', sort);
    if (filter) params.set('filter', filter);
    if (q) params.set('q', q);
    if (pageSize) params.set('pageSize', pageSize);

    const target = `https://vscode-internal-41189-beta.beta01.cloud.kavia.ai:3001/api/session-tracking?${params.toString()}`;
    const response = await axios.get(target, { timeout: 15000 });
    return res.status(200).json(response.data);
  } catch (err) {
    const status = err?.response?.status || 502;
    const data = err?.response?.data || { error: 'Upstream session-tracking error' };
    return res.status(status).json({ proxy: 'session-tracking', ...data });
  }
});

module.exports = router;
