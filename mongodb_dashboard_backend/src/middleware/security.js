const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * Normalize a URL-like string to an origin (scheme://host[:port]).
 * Returns null if it cannot be interpreted as an origin.
 */
function toOriginMaybe(urlLike) {
  if (!urlLike) return null;
  try {
    const u = new URL(urlLike);
    return `${u.protocol}//${u.host}`;
  } catch {
    if (/^https?:\/\/[^/]+$/i.test(urlLike)) return urlLike;
    return null;
  }
}

/**
 * PUBLIC_INTERFACE
 * Build a CORS middleware with a computed whitelist derived from env configuration
 * and explicit support for React dev preview origins.
 *
 * Ensures:
 * - Allowed origins include the specified VSCode preview and localhost:3000.
 * - Preflight OPTIONS responds with proper Allow-* headers.
 * - Allowed headers include x-organization-id, content-type, authorization, accept,
 *   sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, referer, user-agent.
 * - If credentials are enabled, no wildcard origin is used.
 * - Logs Origin and resolved Access-Control-Allow-Origin for diagnostics.
 */
// PUBLIC_INTERFACE
function corsMiddleware() {
  const inferredFromApiBase = toOriginMaybe(process.env.REACT_APP_API_BASE_URL);

  const singleOrigin = toOriginMaybe((process.env.CORS_ORIGIN || '').trim());
  const frontendOrigin = toOriginMaybe((process.env.FRONTEND_ORIGIN || '').trim());
  const listOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => toOriginMaybe(o.trim()))
    .filter(Boolean);

  // Build whitelist set
  const whitelist = new Set();

  // Explicit env-driven values
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

  // Explicitly include required dev origins
  whitelist.add('https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000');
  whitelist.add('http://localhost:3000');
  whitelist.add('https://localhost:3000');

  // Optional known preview
  whitelist.add('https://kavia-dashboard-kavia-dev.cloud.kavia.ai');

  // Default to credentials enabled unless explicitly disabled
  const allowCredentials = String(process.env.CORS_CREDENTIALS || 'true').toLowerCase() === 'true';

  // Allowed headers superset per requirements
  const allowedHeaders = [
    'x-organization-id',
    'content-type',
    'authorization',
    'accept',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'referer',
    'user-agent',
    'origin',
    'cache-control',
    'pragma',
  ];

  // Diagnostic startup log
  try {
    console.log('[CORS] Whitelist:', Array.from(whitelist), '| credentials=', allowCredentials);
  } catch {}

  const corsInstance = cors({
    origin: (origin, callback) => {
      // Non-browser or same-origin (no Origin header)
      if (!origin) {
        return callback(null, true);
      }
      const isAllowed = whitelist.has(origin);
      if (isAllowed) {
        return callback(null, true);
      }

      // Allow same-host with different port for dev convenience
      try {
        const o = new URL(origin);
        const hostAllowed = Array.from(whitelist).some((w) => {
          try {
            return new URL(w).hostname === o.hostname;
          } catch {
            return false;
          }
        });
        if (hostAllowed) {
          return callback(null, true);
        }
      } catch {
        // ignore parsing errors
      }

      console.warn(`[CORS] Rejected Origin: ${origin}`);
      return callback(new Error(`CORS: Origin ${origin} not allowed by server`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders,
    exposedHeaders: ['content-length', 'content-type', 'x-effective-tenant'],
    credentials: allowCredentials,
    optionsSuccessStatus: 204,
    maxAge: 600,
  });

  // Wrap to add logging of Origin and resolved ACAO header
  return (req, res, next) => {
    const origin = req.headers.origin;
    corsInstance(req, res, (err) => {
      if (err) {
        console.warn(
          `[CORS] Blocked origin=${origin || 'n/a'} path=${req.path} method=${req.method} msg=${err.message}`
        );
        return res.status(403).json({ success: false, message: err.message });
      }

      // After cors sets headers, log effective ACAO for diagnosis on /api/*
      if (req.path && req.path.startsWith('/api')) {
        try {
          const acao = res.getHeader('Access-Control-Allow-Origin');
          if (acao && (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true')) {
            console.log(`[CORS] path=${req.path} origin=${origin || 'n/a'} -> ACAO=${acao} credentials=${allowCredentials}`);
          }
        } catch {
          // noop
        }
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
      if (skipGet && req.method === 'GET') return true;
      return false;
    },
    message: { success: false, message: 'Too many requests, please try again later.' },
  });
}

const securityMiddlewares = { corsMiddleware, helmetMiddleware, rateLimiter };
module.exports = { ...securityMiddlewares, default: securityMiddlewares };
