'use strict';

/**
 * PUBLIC_INTERFACE
 * verifyLlmCosts
 * This is a development-only controller that:
 * - Calls the existing GET /api/llm-costs with provided query/header (organization_id, page, limit, sort, from, to, filter).
 * - Measures server-side latency to validate sub-2s target.
 * - Captures key response headers used for diagnostics and UI verification:
 *   x-effective-tenant, x-llm-filter, x-llm-projection, x-llm-sort, x-llm-page, x-llm-limit,
 *   x-llm-timing-parsed-ms, x-llm-timing-built-ms, x-llm-timing-exec-ms, x-llm-timing-explain-ms
 * - On 5xx/504, attempts to read /api/llm-costs/diagnostics/last and include in the output.
 * This route is only enabled when NODE_ENV !== 'production' to avoid exposing internals in prod.
 */
const axios = require('axios');

// PUBLIC_INTERFACE
async function verifyLlmCosts(req, res) {
  /** Development-only safety */
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, message: 'Not available in production' });
  }

  const {
    organization_id,
    tenant_id,
    page = '1',
    limit = '10',
    sort,
    from,
    to,
    filter,
  } = req.query;

  // Prefer header for tenant if provided; otherwise use query params
  const effectiveTenant = req.headers['x-organization-id'] || organization_id || tenant_id;

  if (!effectiveTenant) {
    return res.status(400).json({
      success: false,
      message: 'Missing tenant. Provide x-organization-id header or organization_id/tenant_id query.',
    });
  }

  // Build querystring to forward
  const fwdParams = new URLSearchParams();
  fwdParams.set('organization_id', effectiveTenant);
  if (page) fwdParams.set('page', String(page));
  if (limit) fwdParams.set('limit', String(limit));
  if (sort) fwdParams.set('sort', String(sort));
  if (from) fwdParams.set('from', String(from));
  if (to) fwdParams.set('to', String(to));
  if (filter) fwdParams.set('filter', String(filter));

  const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const targetUrl = `${baseUrl}/api/llm-costs?${fwdParams.toString()}`;

  const headers = {};
  // Forward header explicitly to follow documented precedence
  headers['x-organization-id'] = effectiveTenant;

  let started = Date.now();
  let upstreamResp;
  let error = null;

  try {
    upstreamResp = await axios.get(targetUrl, {
      headers,
      timeout: 15000,
      validateStatus: () => true, // we will handle non-2xx explicitly
    });
  } catch (err) {
    error = err;
  }
  const ended = Date.now();
  const latencyMs = ended - started;

  // Prepare output skeleton
  const output = {
    success: upstreamResp && upstreamResp.status >= 200 && upstreamResp.status < 300,
    status: upstreamResp ? upstreamResp.status : (error && error.response ? error.response.status : 0),
    latencyMs,
    request: {
      url: targetUrl,
      tenant: effectiveTenant,
      params: {
        page: Number(page),
        limit: Number(limit),
        sort: sort || null,
        from: from || null,
        to: to || null,
        filter: filter || null,
      },
    },
    headers: {},
    bodyMeta: null,
    diagnosticsLast: null,
    note: 'This endpoint is for development verification only.',
  };

  if (upstreamResp) {
    // Capture headers of interest
    const h = upstreamResp.headers || {};
    const headerKeys = [
      'x-effective-tenant',
      'x-llm-filter',
      'x-llm-projection',
      'x-llm-sort',
      'x-llm-page',
      'x-llm-limit',
      'x-llm-explain-find',
      'x-llm-explain-count',
      'x-llm-timing-parsed-ms',
      'x-llm-timing-built-ms',
      'x-llm-timing-exec-ms',
      'x-llm-timing-explain-ms',
      'x-llm-window-applied',
      'x-llm-window-from',
      'x-llm-window-to',
    ];
    for (const k of headerKeys) {
      if (k in h) output.headers[k] = h[k];
    }

    // Extract envelope meta and minimal body verification fields
    const data = upstreamResp.data;
    if (data && typeof data === 'object') {
      output.bodyMeta = {
        success: Boolean(data.success),
        hasDataArray: Array.isArray(data.data),
        meta: data.meta ? {
          page: data.meta.page,
          limit: data.meta.limit,
          total: data.meta.total,
          sort: data.meta.sort ?? null,
          hasDebug: Boolean(data.meta.debug),
        } : null,
        firstRowSample: Array.isArray(data.data) && data.data.length > 0 ? sanitizeRow(data.data[0]) : null,
      };
    }

    // If 5xx/504, fetch diagnostics last
    if (upstreamResp.status >= 500) {
      output.diagnosticsLast = await fetchDiagnosticsLast(baseUrl);
    }
  } else {
    // Request-level error (timeout/network). Try diagnostics.
    output.status = 0;
    output.error = serializeError(error);
    output.diagnosticsLast = await fetchDiagnosticsLast(baseUrl);
  }

  return res.status(200).json(output);
}

/** Strip large fields and keep only UI-relevant columns for sample row */
function sanitizeRow(row) {
  if (!row || typeof row !== 'object') return null;
  const {
    _id, request_id, timestamp, model, provider, user_id, organization_id,
    tokens_in, tokens_out, cost_usd, duration_ms, status,
  } = row;
  return {
    _id, request_id, timestamp, model, provider, user_id, organization_id,
    tokens_in, tokens_out, cost_usd, duration_ms, status,
  };
}

function serializeError(err) {
  if (!err) return null;
  return {
    message: err.message,
    code: err.code,
    status: err.response ? err.response.status : undefined,
  };
}

async function fetchDiagnosticsLast(baseUrl) {
  try {
    const resp = await axios.get(`${baseUrl}/api/llm-costs/diagnostics/last`, {
      timeout: 8000,
      validateStatus: () => true,
    });
    return {
      status: resp.status,
      data: resp.data,
    };
  } catch (e) {
    return { status: 0, error: serializeError(e) };
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  verifyLlmCosts,
};
