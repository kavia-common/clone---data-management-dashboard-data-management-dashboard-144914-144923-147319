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
    if (/^https?:\/\/[^/]+$/i.test(urlLike)) return urlLike;
    return null;
  }
}

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

  // Localhost defaults
  // Localhost defaults
  whitelist.add('http://localhost:3000');
  whitelist.add('https://localhost:3000');

  // Preview environment frontend
  whitelist.add('https://vscode-internal-26111-beta.beta01.cloud.kavia.ai:3000');


  const allowCredentials =
    String(process.env.CORS_CREDENTIALS || '').toLowerCase() === 'true';

  console.log('[CORS] Whitelist:', Array.from(whitelist), '| credentials=', allowCredentials);

  const corsInstance = cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // SSR / curl / same-origin
      if (whitelist.has(origin)) return callback(null, true);

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

      // ❌ Explicitly reject with proper CORS message
      return callback(new Error(`CORS: Origin ${origin} not allowed by server`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
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

function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
}

function rateLimiter() {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
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
