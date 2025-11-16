const express = require('express');
const axios = require('axios');

const router = express.Router();

// PUBLIC_INTERFACE
router.get('/session-tracking', async (req, res) => {
  /**
   * Proxy to external session-tracking service.
   * Query params: page, limit, tenant_id, sort, filter, q, pageSize
   * Returns the JSON from the upstream as-is.
   */
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
    res.status(200).json(response.data);
  } catch (err) {
    const status = err?.response?.status || 502;
    const data = err?.response?.data || { error: 'Upstream session-tracking error' };
    res.status(status).json({ proxy: 'session-tracking', ...data });
  }
});

module.exports = router;
