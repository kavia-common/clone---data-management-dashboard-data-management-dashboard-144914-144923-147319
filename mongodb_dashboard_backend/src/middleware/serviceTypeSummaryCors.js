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
  /**
   * The application already has global CORS + preflight handling for all `/api/*`
   * routes (see `src/app.js` mounting `permissiveCorsMiddleware` and `app.options('/api/*', ...)`).
   *
   * To ensure `/api/service-type/summary` follows the same working structure as
   * the other APIs, this route-scoped middleware is intentionally a no-op.
   *
   * Keeping the function (instead of deleting the file) avoids changing imports
   * or wiring elsewhere while ensuring we do not introduce endpoint-specific
   * CORS logic or static/dynamic origin allowlists.
   */
  return next();
}

module.exports = { serviceTypeSummaryCorsMiddleware, default: { serviceTypeSummaryCorsMiddleware } };
