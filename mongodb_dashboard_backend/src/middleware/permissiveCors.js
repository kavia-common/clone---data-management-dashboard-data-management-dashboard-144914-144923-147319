'use strict';

/**
 * PUBLIC_INTERFACE
 * permissiveCorsMiddleware
 * Permissive, non-credentialed CORS for /api/* that echoes request Origin and supports robust preflight:
 * - Access-Control-Allow-Origin: <request Origin> (or "*\" as fallback)
 * - Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
 * - Access-Control-Allow-Headers: Echoes Access-Control-Request-Headers or defaults to a safe superset
 * - No Access-Control-Allow-Credentials (must stay absent when ACAO='*' or echo mode without credentials)
 * - Adds Vary: Origin for cache correctness
 * - Preflight OPTIONS returns 204 immediately
 * - Always sets CORS headers for all responses (including 4xx/5xx)
 *
 * Logs origin/headers in non-production for diagnostics when DEBUG=true.
 */
function permissiveCorsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  const debug =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.DEBUG || '').toLowerCase() === 'true';

  // Echo request origin if present, otherwise fallback to *
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    // Ensure caches consider Origin in response variance
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  // IMPORTANT: Do NOT set Access-Control-Allow-Credentials for non-credentialed flows
  // res.removeHeader('Access-Control-Allow-Credentials');

  // Consolidated allow methods
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );

  // Reflect requested headers for preflight; otherwise, provide a permissive default superset
  const requested = req.headers['access-control-request-headers'];
  // Ensure required headers are always present in defaults
  const requiredAllowHeaders = [
    // required by request spec
    'x-organization-id',
    'content-type',
    'authorization',
    'accept',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'referer',
    'user-agent',
    // additional common/case variants
    'origin',
    'cache-control',
    'pragma',
    'x-org-id',
    'x-tenant-id',
    'x-tenant'
  ];
  // Use browser requested headers if provided; otherwise default to required superset
  const allowHeaders = (requested && typeof requested === 'string' && requested.trim() !== '')
    ? requested
    : requiredAllowHeaders.join(',');

  res.setHeader('Access-Control-Allow-Headers', allowHeaders);

  // Expose some common headers (safe)
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Type,Content-Length,x-effective-tenant'
  );

  // Log resulting ACAO for /api/projects/summary to aid diagnosis
  if (debug && req.path === '/api/projects/summary') {
    try {
      const acao = res.getHeader('Access-Control-Allow-Origin');
      console.log(`[CORS] (permissive) summary ACAO=${acao || 'n/a'} origin=${origin || 'n/a'}`);
    } catch {}
  }

  // Cache preflight result briefly (optional, conservative)
  res.setHeader('Access-Control-Max-Age', '600');

  // Endpoint-focused debug logging to help diagnose CORS
  if (debug && req.path) {
    if (
      req.path === '/api/users' ||
      req.path.startsWith('/api/users') ||
      req.path === '/api/llm-costs' ||
      req.path.startsWith('/api/llm-costs') ||
      req.path === '/api/projects/summary'
    ) {
      console.log(
        `[CORS] path=${req.path} origin=${origin || 'n/a'} method=${req.method} ACRH=${requested || 'n/a'}`
      );
    }
  }

  // Handle preflight OPTIONS early with 204
  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }

  return next();
}

const permissive = { permissiveCorsMiddleware };
module.exports = { ...permissive, default: permissive };