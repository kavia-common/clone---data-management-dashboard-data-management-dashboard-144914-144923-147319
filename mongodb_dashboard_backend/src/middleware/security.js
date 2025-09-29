const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * Build a safe, explicit CORS config.
 * - Supports:
 *    - CORS_ORIGIN as a single origin string
 *    - CORS_ORIGINS as a comma-separated whitelist
 * - Defaults to the known frontend origin for this environment
 * - Allows toggling credentials via CORS_CREDENTIALS
 */
function corsMiddleware() {
  // Default to the specified frontend
  const defaultOrigin = 'https://vscode-internal-28199-beta.beta01.cloud.kavia.ai:4000';

  // Read envs
  const singleOrigin = (process.env.CORS_ORIGIN || '').trim();
  const listOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Compose whitelist
  const whitelist = [];
  if (listOrigins.length) whitelist.push(...listOrigins);
  if (singleOrigin) whitelist.push(singleOrigin);
  if (!whitelist.length) whitelist.push(defaultOrigin);

  const allowCredentials =
    String(process.env.CORS_CREDENTIALS || '').toLowerCase() === 'true';

  // Use a dynamic origin function to validate the request origin
  const originFn = function (origin, callback) {
    // Handle non-browser/SSR or same-origin requests (no Origin header)
    if (!origin) return callback(null, true);

    // Match exact origin
    if (whitelist.includes(origin)) {
      return callback(null, true);
    }

    // Optionally support subdomain wildcards if provided (e.g., https://*.example.com)
    const wildcardAllowed = whitelist.some((allowed) => {
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

    return callback(new Error(`CORS: Origin ${origin} not allowed`));
  };

  return cors({
    origin: originFn,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: allowCredentials,
    optionsSuccessStatus: 204,
  });
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
