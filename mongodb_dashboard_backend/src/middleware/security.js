const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * Normalize a URL-like string to an origin (scheme://host[:port]).
 * Returns null if it cannot be interpreted as an origin.
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
 * Normalize a comma-separated env var containing origins into a list of valid origins.
 */
function parseOriginsEnv(value) {
  if (!value || typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map((o) => toOriginMaybe(o.trim()))
    .filter(Boolean);
}

/**
 * PUBLIC_INTERFACE
 * Build a CORS middleware with a computed whitelist derived from env configuration.
 *
 * Env vars supported:
 * - ALLOWED_ORIGINS: Comma-separated list of origins to allow (preferred).
 * - REACT_APP_API_BASE_URL: If set, its origin is allowed (e.g., https://api.example.com/api -> https://api.example.com).
 * - CORS_ORIGIN: A single explicit origin to allow.
 * - CORS_ORIGINS: Comma-separated list of origins to allow (legacy).
 * - FRONTEND_ORIGIN: Convenience single origin for the frontend host.
 * - CORS_CREDENTIALS: "true" to enable credentialed requests.
 *   Also supports aliases: CORS_ALLOW_CREDENTIALS, CORS_ALLOW_CREDENTIAL, CORS_WITH_CREDENTIALS
 * - ALLOWED_METHODS: Optional comma-separated list of methods (default: GET,POST,PUT,DELETE,PATCH,OPTIONS)
 * - ALLOWED_HEADERS: Optional comma-separated list of headers.
 * - CORS_MAX_AGE: Optional max-age for preflight caching in seconds.
 *
 * Default allowances:
 * - http://localhost:3000
 * - https://localhost:3000
 * - vscode-internal preview origin(s) when present in inferred allowlist
 *
 * Behavior:
 * - Allows exact whitelisted origins.
 * - If not an exact match, allows same-host across different ports (helps dev/proxy scenarios).
 * - Allows Kavia preview origins of the form: https://vscode-internal-<port>-<stage>.<...>:3000
 * - Returns 403 JSON on CORS rejection with a clear message.
 * - Handles OPTIONS preflight with 204 status.
 */
// PUBLIC_INTERFACE
function corsMiddleware() {
  const inferredFromApiBase = toOriginMaybe(process.env.REACT_APP_API_BASE_URL);

  const singleOrigin = toOriginMaybe((process.env.CORS_ORIGIN || '').trim());
  const frontendOrigin = toOriginMaybe((process.env.FRONTEND_ORIGIN || '').trim());

  // Prefer ALLOWED_ORIGINS but support older CORS_ORIGINS too.
  const allowedOriginsEnv = parseOriginsEnv(process.env.ALLOWED_ORIGINS);
  const corsOriginsEnv = parseOriginsEnv(process.env.CORS_ORIGINS);

  const whitelist = new Set();

  // Explicit values
  [...allowedOriginsEnv, ...corsOriginsEnv].forEach((o) => whitelist.add(o));
  if (singleOrigin) {
    whitelist.add(singleOrigin);
  }
  if (frontendOrigin) {
    whitelist.add(frontendOrigin);
  }

  // Infer from API base (useful when env contains full /api URL)
  if (inferredFromApiBase) {
    whitelist.add(inferredFromApiBase);
    try {
      const u = new URL(inferredFromApiBase);
      const protoHost = `${u.protocol}//${u.hostname}`;
      // Common dev/preview ports
      whitelist.add(`${protoHost}:3000`);
      whitelist.add(`${protoHost}:4000`);
    } catch {
      // ignore
    }
  }

  // Localhost defaults
  whitelist.add('http://localhost:3000');
  whitelist.add('https://localhost:3000');

  // Support common env var aliases to avoid deployments accidentally disabling credentials.
  const allowCredentialsRaw =
    process.env.CORS_CREDENTIALS ??
    process.env.CORS_ALLOW_CREDENTIALS ??
    process.env.CORS_ALLOW_CREDENTIAL ??
    process.env.CORS_WITH_CREDENTIALS;

  // Default to true because this backend is used with cookie auth in the dashboard.
  const allowCredentials =
    String(allowCredentialsRaw ?? 'true').toLowerCase() === 'true';

  const allowedMethodsRaw = process.env.ALLOWED_METHODS;
  const methods =
    allowedMethodsRaw && typeof allowedMethodsRaw === 'string' && allowedMethodsRaw.trim() !== ''
      ? allowedMethodsRaw
          .split(',')
          .map((m) => m.trim().toUpperCase())
          .filter(Boolean)
      : ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

  const allowedHeadersRaw = process.env.ALLOWED_HEADERS;
  const allowedHeaders =
    allowedHeadersRaw && typeof allowedHeadersRaw === 'string' && allowedHeadersRaw.trim() !== ''
      ? allowedHeadersRaw
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean)
      : [
          'x-organization-id',
          'Content-Type',
          'Authorization',
          'Accept',
          'sec-ch-ua',
          'sec-ch-ua-mobile',
          'sec-ch-ua-platform',
          'Referer',
          'User-Agent',
          'Origin',
          'Cache-Control',
          'Pragma',
        ];

  const maxAgeRaw = process.env.CORS_MAX_AGE;
  const maxAge =
    maxAgeRaw && String(maxAgeRaw).trim() !== '' ? parseInt(String(maxAgeRaw), 10) : undefined;

  try {
    // eslint-disable-next-line no-console
    console.log(
      '[CORS] Whitelist:',
      Array.from(whitelist),
      '| credentials=',
      allowCredentials,
      '| methods=',
      methods.join(','),
      '| headers=',
      allowedHeaders.join(',')
    );
  } catch {}

  const kaviaPreviewOriginRegex =
    /^https:\/\/vscode-internal-\d+-[a-z0-9-]+\.[a-z0-9.-]+(?::\d+)?$/i;

  // Build dynamic CORS instance.
  const corsInstance = cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true); // SSR / curl / same-origin
      }
      if (whitelist.has(origin)) {
        return callback(null, true);
      }

      // Allow Kavia preview origins (for beta preview frontends).
      if (kaviaPreviewOriginRegex.test(origin)) {
        return callback(null, true);
      }

      // Check same hostname, different port
      try {
        const o = new URL(origin);
        const whitelistHosts = Array.from(whitelist)
          .map((w) => {
            try {
              return new URL(w).hostname;
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        if (whitelistHosts.includes(o.hostname)) {
          return callback(null, true);
        }
      } catch {
        // ignore
      }

      return callback(new Error(`CORS: Origin ${origin} not allowed by server`));
    },
    methods,
    allowedHeaders,
    exposedHeaders: ['Content-Length', 'Content-Type', 'x-effective-tenant'],
    credentials: allowCredentials,
    optionsSuccessStatus: 204,
    maxAge,
  });

  return (req, res, next) => {
    corsInstance(req, res, (err) => {
      if (err) {
        console.warn(`[CORS] Blocked origin: ${req.headers.origin}`);
        return res.status(403).json({
          success: false,
          message: err.message,
        });
      }

      /**
       * Ensure ACAC is present when credentials are enabled.
       *
       * In some proxy/deployment situations, relying on downstream behavior can lead to
       * missing `Access-Control-Allow-Credentials` even when configured. Since this backend
       * is intended to support cookie auth, we make this explicit.
       */
      if (allowCredentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
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
  const skipGet =
    String(process.env.RATE_LIMIT_SKIP_GET ?? 'true').toLowerCase() !== 'false';

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
