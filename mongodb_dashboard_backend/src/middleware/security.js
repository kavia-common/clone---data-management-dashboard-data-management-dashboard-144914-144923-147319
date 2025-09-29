const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

function corsMiddleware() {
  const origin = process.env.CORS_ORIGIN || '*';
  return cors({
    origin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
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
