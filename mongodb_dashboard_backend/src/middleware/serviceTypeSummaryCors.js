'use strict';

/**
 * PUBLIC_INTERFACE
 * serviceTypeSummaryCorsMiddleware
 *
 * Route-scoped CORS middleware specifically for:
 *   GET/OPTIONS /api/service-type/summary
 *
 * Why this exists:
 * - The service-type summary call is made from the dashboard UI using cookies (credentialed request).
 * - Credentialed CORS requires:
 *   - Access-Control-Allow-Credentials: true
 *   - Access-Control-Allow-Origin must be an explicit origin (not '*')
 * - We intentionally do NOT change global CORS behavior for other endpoints.
 *
 * Allowed origins:
 * - Local dev: http://localhost:3000
 * - Live/hosted: https://kavia-dashboard-kavia-beta.cloud.kavia.ai
 * - Kavia preview/VSCode internal domains on port 3000 (pattern-based)
 *
 * Notes:
 * - We set Vary: Origin to keep caches safe.
 * - We reflect requested headers for preflight when present.
 * - OPTIONS preflight terminates with 204.
 */
function serviceTypeSummaryCorsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  // Only apply to the exact endpoint we were asked to fix.
  // (Mounted at /api/service-type, this should only see /summary, but keep it defensive.)
  const path = req.originalUrl || req.url || '';
  const isTargetEndpoint = path.includes('/api/service-type/summary') || path === '/summary' || path.startsWith('/summary?');
  if (!isTargetEndpoint) {
    return next();
  }

  const allowedExact = new Set([
    'http://localhost:3000',
    'https://localhost:3000',
    'https://kavia-dashboard-kavia-beta.cloud.kavia.ai',
  ]);

  const isAllowedPreviewOrigin = (o) => {
    if (!o || typeof o !== 'string') return false;
    // Example: https://vscode-internal-29822-beta.beta01.cloud.kavia.ai:3000
    // Allow any subdomain that starts with "vscode-internal-" under *.cloud.kavia.ai:3000
    return /^https:\/\/vscode-internal-[a-z0-9-]+\.beta\d+\.cloud\.kavia\.ai:3000$/i.test(o)
      || /^https:\/\/vscode-internal-[a-z0-9-]+\.cloud\.kavia\.ai:3000$/i.test(o);
  };

  const originAllowed = !origin || allowedExact.has(origin) || isAllowedPreviewOrigin(origin);

  if (origin && originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    // Cache correctness when origin is echoed
    res.setHeader('Vary', 'Origin');
    // Credentialed CORS (cookies)
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // Reflect requested headers (preferred), else allow a safe superset.
  const requestedHeaders = req.headers['access-control-request-headers'];
  const defaultAllowHeaders = [
    'x-organization-id',
    'content-type',
    'authorization',
    'accept',
    'origin',
    'cache-control',
    'pragma',
    'referer',
    'user-agent',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
  ].join(',');

  res.setHeader('Access-Control-Allow-Headers', (requestedHeaders && String(requestedHeaders).trim()) ? requestedHeaders : defaultAllowHeaders);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type,Content-Length,x-effective-tenant');

  // If the browser preflights, respond directly.
  if (req.method === 'OPTIONS') {
    // If origin is not allowed, we still return 204 without CORS headers (browser will block).
    return res.status(204).send();
  }

  return next();
}

module.exports = { serviceTypeSummaryCorsMiddleware, default: { serviceTypeSummaryCorsMiddleware } };
