'use strict';

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

/**
 * PUBLIC_INTERFACE
 * helmetMiddleware
 * Wrap helmet with a safe default.
 */
function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * PUBLIC_INTERFACE
 * corsMiddleware
 * Allow basic local dev by default, read FRONTEND_ORIGIN/CORS_ORIGINS if provided.
 */
function corsMiddleware() {
  const origins = [];

  if (process.env.FRONTEND_ORIGIN) origins.push(process.env.FRONTEND_ORIGIN);
  if (process.env.CORS_ORIGINS) {
    origins.push(...String(process.env.CORS_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean));
  }
  // Always allow localhost dev by default
  origins.push('http://localhost:3000', 'http://127.0.0.1:3000');

  return cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non-browser clients
      if (origins.includes(origin)) return callback(null, true);
      return callback(null, true); // permissive for preview
    },
    credentials: true,
  });
}

/**
 * PUBLIC_INTERFACE
 * rateLimiter
 * Basic rate limiter suitable for preview/dev.
 */
function rateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

module.exports = { helmetMiddleware, corsMiddleware, rateLimiter };
