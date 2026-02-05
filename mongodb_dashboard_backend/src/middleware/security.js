const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * Normalize a URL-like string to an origin (scheme://host[:port]).
 * Returns null if it cannot be interpreted as an origin.
 *
 * Note: this is intentionally strict and only returns a concrete origin, not a pattern.
 */
function toOriginMaybe(urlLike) {
  if (!urlLike) {
    return null;
  }
  try {
    const u = new URL(urlLike);
    return `${u.protocol}//${u.host}`;
  } catch {
    if (/^https?:\/\/[^/]+$/i.test(urlLike)) {
      return urlLike;
    }
    return null;
  }
}

/**
 * Convert a wildcard origin pattern into a RegExp.
 *
 * Supported syntax:
 * - '*' matches any sequence of characters except '/' (we only expect origins, so no '/')
 *
 * Examples:
 * - 'https://vscode-internal-*-beta.beta01.cloud.kavia.ai:3000'
 * - 'https://*.cloud.kavia.ai'
 *
 * Returns null when the input is not a recognizable wildcard origin pattern.
 */
function wildcardOriginToRegex(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    return null;
  }
  const p = pattern.trim();
  // We only support http(s) schemes for security/clarity.
  if (!/^https?:\/\//i.test(p)) {
    return null;
  }
  // Treat as wildcard pattern only if it contains '*'
  if (!p.includes('*')) {
    return null;
  }

  // Escape regex meta chars other than '*', then expand '*' to a safe wildcard.
  const escaped = p
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*');

  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * PUBLIC_INTERFACE
 * Build a CORS middleware with a computed whitelist derived from env configuration.
 *
 * Primary env vars (manifest-driven):
 * - ALLOWED_ORIGINS: Comma-separated list of allowed origins (scheme://host[:port])
 * - ALLOWED_HEADERS: Comma-separated list of allowed request headers
 * - ALLOWED_METHODS: Comma-separated list of allowed HTTP methods
 * - CORS_MAX_AGE: Max age (seconds) for browser preflight caching
 * - CORS_CREDENTIALS: "true" to enable credentialed requests (cookies/authorization)
 *
 * Backward-compatible env vars:
 * - REACT_APP_API_BASE_URL, CORS_ORIGIN, CORS_ORIGINS, FRONTEND_ORIGIN
 *
 * Behavior:
 * - Allows exact whitelisted origins.
 * - If not an exact match, allows same-host across different ports (helps dev/proxy scenarios).
 * - Returns 403 JSON on CORS rejection with a clear message.
 * - Handles OPTIONS preflight with 204 status.
 */
// PUBLIC_INTERFACE
function corsMiddleware() {
  const inferredFromApiBase = toOriginMaybe(process.env.REACT_APP_API_BASE_URL);

  /**
   * Manifest-first allowlist
   *
   * We support:
   * 1) exact origins: 'https://example.com:3000'
   * 2) wildcard patterns: 'https://vscode-internal-*-beta.beta01.cloud.kavia.ai:3000'
   *
   * Wildcards are compiled into RegExp matchers and are only consulted if the origin
   * is not an exact match.
   */
  const allowedOriginsRaw = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => String(o || '').trim())
    .filter(Boolean);

  const allowedOriginsFromManifest = allowedOriginsRaw
    .map((o) => toOriginMaybe(o))
    .filter(Boolean);

  const allowedOriginPatternsFromManifest = allowedOriginsRaw
    .map((o) => wildcardOriginToRegex(o))
    .filter(Boolean);

  // Backward-compatible allowlist sources (exact only)
  const singleOrigin = toOriginMaybe((process.env.CORS_ORIGIN || '').trim());
  const frontendOrigin = toOriginMaybe((process.env.FRONTEND_ORIGIN || '').trim());
  const listOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => toOriginMaybe(o.trim()))
    .filter(Boolean);

  const whitelist = new Set();
  const originMatchers = [...allowedOriginPatternsFromManifest];

  // Explicit values (manifest first)
  allowedOriginsFromManifest.forEach((o) => whitelist.add(o));

  // Backward compatible values
  listOrigins.forEach((o) => whitelist.add(o));
  if (singleOrigin) whitelist.add(singleOrigin);
  if (frontendOrigin) whitelist.add(frontendOrigin);

  // Infer from API base
  if (inferredFromApiBase) {
    whitelist.add(inferredFromApiBase);
    try {
      const u = new URL(inferredFromApiBase);
      const protoHost = `${u.protocol}//${u.hostname}`;
      whitelist.add(`${protoHost}:3000`);
      whitelist.add(`${protoHost}:4000`);
    } catch {
      // ignore
    }
  }

  /**
   * If no env-driven origins are configured, strict CORS would otherwise default to ONLY localhost
   * (see defaults below), which breaks real deployments.
   *
   * Add a minimal, deployment-specific fallback set for Kavia beta environments so that:
   * - https://kavia-dashboard-kavia-beta.cloud.kavia.ai can be called from
   * - https://vscode-internal-*-beta.beta01.cloud.kavia.ai:* preview frontends
   *
   * These are only applied when the allowlist is otherwise empty (excluding localhost),
   * so properly configured environments remain fully env-driven/strict.
   */
  const hasAnyConfiguredOrigins =
    allowedOriginsFromManifest.length > 0 ||
    listOrigins.length > 0 ||
    Boolean(singleOrigin) ||
    Boolean(frontendOrigin) ||
    Boolean(inferredFromApiBase);

  /**
   * Beta preview safeguard
   *
   * In beta, it is common to set:
   *   ALLOWED_ORIGINS=https://kavia-dashboard-kavia-beta.cloud.kavia.ai
   * but forget to include the actual *browser* origin:
   *   https://vscode-internal-<id>-beta.beta01.cloud.kavia.ai:3000
   *
   * Since this backend supports credentialed CORS (cookies), the Origin must be explicitly
   * allowed and echoed. To avoid a persistent CORS failure on preview frontends, we add
   * the preview wildcard matcher when the beta API domain is allowlisted but the preview
   * origin isn't.
   *
   * This remains strict: we still only allow the specific Kavia preview hostname pattern,
   * not arbitrary origins.
   */
  const betaApiOrigin = 'https://kavia-dashboard-kavia-beta.cloud.kavia.ai';
  const hasBetaApiAllowed =
    whitelist.has(betaApiOrigin) || allowedOriginsFromManifest.includes(betaApiOrigin);

  if (hasBetaApiAllowed) {
    const previewWildcard = wildcardOriginToRegex(
      'https://vscode-internal-*-beta.beta01.cloud.kavia.ai:3000'
    );
    if (previewWildcard) {
      originMatchers.push(previewWildcard);
    }
  }

  if (!hasAnyConfiguredOrigins) {
    // Deployed beta domain(s) (API host itself may appear as Origin in some same-site flows)
    whitelist.add(betaApiOrigin);

    // Common Kavia preview frontend origins (vscode-internal) seen in beta validation.
    // We include:
    // - an exact observed origin for immediate compatibility
    // - a wildcard pattern so new preview instances do not regress CORS
    whitelist.add('https://vscode-internal-27924-beta.beta01.cloud.kavia.ai:3000');

    const previewWildcard = wildcardOriginToRegex(
      'https://vscode-internal-*-beta.beta01.cloud.kavia.ai:3000'
    );
    if (previewWildcard) {
      originMatchers.push(previewWildcard);
    }
  }

  // Localhost defaults (safe dev defaults)
  whitelist.add('http://localhost:3000');
  whitelist.add('https://localhost:3000');

  // Credentialed requests (cookies) require explicit origin (no '*')
  // Default to true because the reported failing call includes cookies.
  const allowCredentials =
    String(process.env.CORS_CREDENTIALS || 'true').toLowerCase() === 'true';

  const maxAgeSeconds = parseInt(process.env.CORS_MAX_AGE || '600', 10);

  const allowedMethods = (process.env.ALLOWED_METHODS || 'GET,POST,PUT,DELETE,PATCH,OPTIONS')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  // If ALLOWED_HEADERS is provided, honor it BUT always union with required baseline headers
  // used across the app (e.g., x-organization-id for tenant scoping).
  //
  // Why: a too-restrictive ALLOWED_HEADERS (like only Content-Type/Authorization) will cause
  // browsers to fail preflight for routes that require custom headers, which looks like a
  // "CORS issue" only on some endpoints.
  const baselineHeaders = [
    'x-organization-id',
    'Content-Type',
    'Authorization',
    'Accept',
    'X-Requested-With',

    // Common preflight headers. While these are primarily *request* headers, allowing
    // them makes the allowlist resilient across browser/proxy variations.
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',

    // Browser client hints / common browser headers sometimes appear in preflight allowlists
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'Referer',
    'User-Agent',
    'Origin',
    'Cache-Control',
    'Pragma',
  ];

  const envHeadersRaw = (process.env.ALLOWED_HEADERS || '').trim();
  const envHeaders =
    envHeadersRaw !== ''
      ? envHeadersRaw
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean)
      : [];

  // Normalize to lowercase for reliable de-dupe, then preserve original casing via baseline list.
  const allowedHeaders = Array.from(
    new Set(
      [...envHeaders, ...baselineHeaders]
        .filter(Boolean)
        .map((h) => String(h).trim())
        .filter(Boolean)
        .map((h) => h.toLowerCase())
    )
  );

  // eslint-disable-next-line no-console
  console.log('[CORS] Whitelist:', Array.from(whitelist), '| credentials=', allowCredentials);

  const corsInstance = cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // SSR / curl / same-origin

      if (whitelist.has(origin)) return callback(null, true);

      // Wildcard/pattern match (useful for preview domains whose subdomain varies)
      if (originMatchers.some((re) => re.test(origin))) {
        return callback(null, true);
      }

      // Same-host across different ports (dev/proxy scenarios)
      try {
        const o = new URL(origin);
        if (
          Array.from(whitelist).some((w) => {
            try {
              return new URL(w).hostname === o.hostname;
            } catch {
              return false;
            }
          })
        ) {
          return callback(null, true);
        }
      } catch {
        // ignore
      }

      return callback(new Error(`CORS: Origin ${origin} not allowed by server`));
    },
    methods: allowedMethods,
    allowedHeaders,
    exposedHeaders: ['Content-Length', 'Content-Type', 'x-effective-tenant'],
    credentials: allowCredentials,
    maxAge: Number.isFinite(maxAgeSeconds) ? maxAgeSeconds : 600,
    optionsSuccessStatus: 204,
  });

  return (req, res, next) => {
    corsInstance(req, res, (err) => {
      // Ensure multi-origin CORS responses are cached safely by intermediaries.
      // (Without this, a CDN/proxy could cache a response with Allow-Origin for A
      // and serve it to origin B, appearing as a "random" CORS failure.)
      res.vary('Origin');

      if (err) {
        console.warn(`[CORS] Blocked origin: ${req.headers.origin}`);
        return res.status(403).json({
          success: false,
          message: err.message,
        });
      }
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      return next();
    });
  };
}

/**
 * PUBLIC_INTERFACE
 * Build a Helmet middleware with relaxed CSP (disabled) to avoid conflicts
 * with Swagger UI and dynamic content, while keeping CORP permissive for cross-origin resources.
 */
// PUBLIC_INTERFACE
function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
}

/**
 * PUBLIC_INTERFACE
 * Build a rate limiter middleware suitable for dashboards.
 *
 * Env vars:
 * - RATE_LIMIT_WINDOW_MS: Window in ms (default: 900000 -> 15 minutes)
 * - RATE_LIMIT_MAX: Max requests per IP per window (default: 200)
 * - RATE_LIMIT_SKIP_GET: When "true" (default), skip limiting for GET requests to reduce 429s on table interactions.
 */
// PUBLIC_INTERFACE
function rateLimiter() {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
  const max = parseInt(process.env.RATE_LIMIT_MAX || '200', 10);
  const skipGet = String(process.env.RATE_LIMIT_SKIP_GET ?? 'true').toLowerCase() !== 'false';

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // By default, skip throttling for GET endpoints (listing, sorting, pagination)
      if (skipGet && req.method === 'GET') {
        return true;
      }
      return false;
    },
    message: { success: false, message: 'Too many requests, please try again later.' },
  });
}

const securityMiddlewares = { corsMiddleware, helmetMiddleware, rateLimiter };
module.exports = { ...securityMiddlewares, default: securityMiddlewares };
