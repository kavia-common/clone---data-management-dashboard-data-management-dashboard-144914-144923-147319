const express = require('express');
const axios = require('axios');
const https = require('https');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/proxy/session-tracking
 *
 * Proxy endpoint to fetch session tracking data from an upstream service.
 * - Passes through query params: page, limit, tenant_id, session_id (optional), sort, filter, q, pageSize
 * - Upstream base URL is configurable via environment variables:
 *     SESSION_TRACKING_UPSTREAM_BASE (preferred), falls back to REACT_APP_BACKEND_URL, then a safe default.
 *   Example: https://example.com/api
 * - Supports self-signed certificates if SESSION_TRACKING_UPSTREAM_INSECURE_TLS=true (development only).
 * - Returns 200 OK with JSON when upstream succeeds, or a structured error JSON when it fails.
 */
router.get('/session-tracking', async (req, res) => {
  // Build upstream base url
  const envBase =
    process.env.SESSION_TRACKING_UPSTREAM_BASE ||
    process.env.REACT_APP_BACKEND_URL ||
    'http://localhost:3001/api';

  // Normalize trailing slashes
  const upstreamBase = envBase.replace(/\/+$/, '');

  // TLS agent for optional insecure mode (dev only)
  const insecureTls =
    String(process.env.SESSION_TRACKING_UPSTREAM_INSECURE_TLS || '').toLowerCase() === 'true';
  const httpsAgent = insecureTls
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

  // Collect and forward expected query params
  const {
    page,
    limit,
    tenant_id,
    session_id, // Optional filter for a specific session id
    sort,
    filter,
    q,
    pageSize,
  } = req.query;

  const params = new URLSearchParams();
  if (page) params.set('page', page);
  if (limit) params.set('limit', limit);
  if (tenant_id) params.set('tenant_id', tenant_id);
  if (session_id) params.set('session_id', session_id);
  if (sort) params.set('sort', sort);
  if (filter) params.set('filter', filter);
  if (q) params.set('q', q);
  if (pageSize) params.set('pageSize', pageSize);

  const url = `${upstreamBase}/session-tracking?${params.toString()}`;

  // Always set permissive CORS for proxy (frontend consumption)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const response = await axios.get(url, {
      timeout: 20000,
      // Forward minimal headers that are safe/usable upstream
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      httpsAgent,
      // Allow redirects if upstream issues 30x
      maxRedirects: 3,
      validateStatus: () => true, // handle status manually to map upstream errors cleanly
    });

    // Map upstream response
    if (response.status >= 200 && response.status < 300) {
      return res.status(200).json(response.data);
    }

    // Upstream returned an error-like status; return structured message
    return res.status(response.status || 502).json({
      success: false,
      proxy: 'session-tracking',
      message: 'Upstream responded with an error',
      upstream_status: response.status,
      upstream_url: url,
      data: typeof response.data === 'object' ? response.data : { body: String(response.data) },
    });
  } catch (error) {
    // Network error, timeout, TLS error, DNS, etc.
    const isTimeout = error?.code === 'ECONNABORTED';
    const isTls = error?.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error?.code === 'SELF_SIGNED_CERT_IN_CHAIN';
    return res.status(502).json({
      success: false,
      proxy: 'session-tracking',
      message: 'Failed to reach upstream session-tracking service',
      reason: isTimeout ? 'timeout' : isTls ? 'tls' : error?.code || 'network_error',
      upstream_url: url,
      hint:
        isTls && !insecureTls
          ? 'If this is a dev environment with self-signed certs, set SESSION_TRACKING_UPSTREAM_INSECURE_TLS=true'
          : undefined,
    });
  }
});

module.exports = router;
