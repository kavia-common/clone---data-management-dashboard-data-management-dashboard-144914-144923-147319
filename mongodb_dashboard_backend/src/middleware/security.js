const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * Normalize a URL/string to origin (scheme://host:port)
 */
function toOriginMaybe(urlLike) {
  if (!urlLike) return null;
  try {
    const u = new URL(urlLike);
    return `${u.protocol}//${u.host}`;
  } catch {
    // If it's already an origin without path or lacks protocol, try to coerce
    if (/^https?:\/\/[^/]+$/i.test(urlLike)) return urlLike;
    return null;
  }
}

/**
 * Build a safe, explicit CORS config.
 * - Supports:
 *    - CORS_ORIGIN as a single origin string
 *    - CORS_ORIGINS as a comma-separated whitelist
 *    - FRONTEND_ORIGIN as a convenience alias for a single origin
 *    - REACT_APP_API_BASE_URL: will be parsed to infer and allow the frontend origin automatically
 * - Adds sensible fallbacks for local/dev usage
 * - Allows toggling credentials via CORS_CREDENTIALS
 */
function corsMiddleware() {
  // Try to infer frontend origin from REACT_APP_API_BASE_URL if provided (strip path to origin)
  const inferredFromApiBase = toOriginMaybe(process.env.REACT_APP_API_BASE_URL);

  // Read envs
  const singleOrigin = toOriginMaybe((process.env.CORS_ORIGIN || '').trim());
  const frontendOrigin = toOriginMaybe((process.env.FRONTEND_ORIGIN || '').trim());
  const listOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => toOriginMaybe(o.trim()))
    .filter(Boolean);

  // Compose whitelist
  const whitelist = new Set();

  // 1) Explicit list first
  listOrigins.forEach((o) => whitelist.add(o));
  if (singleOrigin) whitelist.add(singleOrigin);
  if (frontendOrigin) whitelist.add(frontendOrigin);

  // 2) From API base URL (common in frontend .env)
  if (inferredFromApiBase) {
    whitelist.add(inferredFromApiBase);

    // If API base is https://host:3001/api, also add a sibling frontend default
    // such as https://host:3000 and https://host:4000 for common dev/preview ports.
    try {
      const u = new URL(inferredFromApiBase);
      const protoHost = `${u.protocol}//${u.hostname}`;
      whitelist.add(`${protoHost}:3000`);
      whitelist.add(`${protoHost}:4000`);
    } catch {
      // ignore parse errors
    }
  }

  // 3) Localhost defaults
  whitelist.add('http://localhost:3000');
  whitelist.add('https://localhost:3000');

  // Allow credentialed requests when enabled
  const allowCredentials =
    String(process.env.CORS_CREDENTIALS || '').toLowerCase() === 'true';

  // Use a dynamic origin function to validate the request origin
  const originFn = function (origin, callback) {
    // Handle non-browser/SSR or same-origin requests (no Origin header)
    if (!origin) return callback(null, true);

    // Exact origin match
    if (whitelist.has(origin)) {
      return callback(null, true);
    }

    // Support subdomain wildcards from configured entries (e.g., https://*.example.com)
    const wildcardAllowed = Array.from(whitelist).some((allowed) => {
      if (!allowed.includes('*')) return false;
      const regex = new RegExp(
        '^' +
          allowed
            .replace(/\./g, '\\.')
            .replace(/\*/g, '[^.]+') +
          '$'
      );
      return regex.test(origin);
    });
    if (wildcardAllowed) return callback(null, true);

    // As a last resort, allow sibling port 3000 or 4000 for same host (common for frontend dev/preview),
    // when the backend is accessed at https://host:3001 and frontend at https://host:3000 or :4000
    try {
      const o = new URL(origin);
      const sibling3000 = `${o.protocol}//${o.hostname}:3000`;
      const sibling4000 = `${o.protocol}//${o.hostname}:4000`;
      if (whitelist.has(sibling3000) || whitelist.has(sibling4000)) return callback(null, true);

      // If whitelist contains the same hostname (regardless of port), allow it
      if (
        Array.from(whitelist).some((w) => {
          try {
            const wUrl = new URL(w);
            return wUrl.hostname === o.hostname;
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

    return callback(new Error(`CORS: Origin ${origin} not allowed`));
  };

  // Log the effective whitelist once for diagnostics
  // eslint-disable-next-line no-console
  console.log('[CORS] Whitelist:', Array.from(whitelist), '| credentials=', allowCredentials);

  const corsInstance = cors({
    origin: originFn,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    credentials: allowCredentials,
    optionsSuccessStatus: 204,
  });

  // Return a middleware that also ensures preflight handled
  return (req, res, next) => {
    corsInstance(req, res, (err) => {
      if (err) return next(err);
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      return next();
    });
  };
}

function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
}

function rateLimiter() {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 minutes
  const max = parseInt(process.env.RATE_LIMIT_MAX || '200', 10);
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later.' },
  });
}

module.exports = { corsMiddleware, helmetMiddleware, rateLimiter };
