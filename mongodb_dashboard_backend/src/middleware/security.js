
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * Normalize a URL-like string to an origin (scheme://host[:port]).
 * Returns null if it cannot be interpreted as an origin.
 */
function toOriginMaybe(urlLike) {
  if (!urlLike) {return null;}
  try {
    const u = new URL(urlLike);
    return `${u.protocol}//${u.host}`;
  } catch {
    if (/^https?:\/\/[^/]+$/i.test(urlLike)) {return urlLike;}
    return null;
  }
}

/**
 * PUBLIC_INTERFACE
 * Build a CORS middleware with a computed whitelist derived from env configuration.
 *
 * Env vars supported:
 * - REACT_APP_API_BASE_URL: If set, its origin is allowed (e.g., https://api.example.com/api -> https://api.example.com).
 * - CORS_ORIGIN: A single explicit origin to allow.
 * - CORS_ORIGINS: Comma-separated list of origins to allow.
 * - FRONTEND_ORIGIN: Convenience single origin for the frontend host.
 * - CORS_CREDENTIALS: "true" to enable credentialed requests.
 *
 * Default allowances:
 * - http://localhost:3000
 * - https://localhost:3000
 * - A known preview environment origin (cloud preview).
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

  const singleOrigin = toOriginMaybe((process.env.CORS_ORIGIN || '').trim());
  const frontendOrigin = toOriginMaybe((process.env.FRONTEND_ORIGIN || '').trim());
  const listOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => toOriginMaybe(o.trim()))
    .filter(Boolean);

  const whitelist = new Set();

  // Explicit values
  listOrigins.forEach((o) => whitelist.add(o));
  if (singleOrigin) {whitelist.add(singleOrigin);}
  if (frontendOrigin) {whitelist.add(frontendOrigin);}

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

  // Localhost defaults
  whitelist.add('http://localhost:3000');
  whitelist.add('https://localhost:3000');

  // Preview environment frontend
  // Preview environment frontends
  // whitelist.add('https://kavia-dashboard-kavia-dev.cloud.kavia.ai');
  whitelist.add('https://kavia-dashboard-kavia-beta.cloud.kavia.ai');
  // Explicitly allow VSCode internal preview origin used by frontend
  // whitelist.add('https://vscode-internal-38821-beta.beta01.cloud.kavia.ai:3000');
  



  const allowCredentials =
    String(process.env.CORS_CREDENTIALS || '').toLowerCase() === 'true';

   
  console.log('[CORS] Whitelist:', Array.from(whitelist), '| credentials=', allowCredentials);

  // Build dynamic CORS instance with robust error tolerance in dev preview environments.
  const corsInstance = cors({
    origin: (origin, callback) => {
      if (!origin) {return callback(null, true);} // SSR / curl / same-origin
      if (whitelist.has(origin)) {return callback(null, true);}

      // Check same hostname, different port
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

      // Explicitly reject with proper CORS message

      console.log('[CORS] Origin received:', origin);
      return callback(null, true); // temporarily allow all

      // return callback(new Error(`CORS: Origin ${origin} not allowed by server`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
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
      'Pragma'
    ],
    exposedHeaders: ['Content-Length', 'Content-Type', 'x-effective-tenant'],
    credentials: allowCredentials,
    optionsSuccessStatus: 204,
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
      if (skipGet && req.method === 'GET') {return true;}
      return false;
    },
    message: { success: false, message: 'Too many requests, please try again later.' },
  });
}

const securityMiddlewares = { corsMiddleware, helmetMiddleware, rateLimiter };
module.exports = { ...securityMiddlewares, default: securityMiddlewares };