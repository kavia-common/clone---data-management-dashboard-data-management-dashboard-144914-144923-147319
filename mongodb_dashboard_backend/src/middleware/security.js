'use strict';

const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * PUBLIC_INTERFACE
 * Returns an Express helmet middleware configured with sane defaults.
 */
function helmetMiddleware() {
  /** This is a public function. */
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * PUBLIC_INTERFACE
 * CORS middleware allowing configured frontend origin plus localhost.
 */
function corsMiddleware() {
  /** This is a public function. */
  const envOrigin = process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || '';
  const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    envOrigin
  ].filter(Boolean);

  return cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET','POST','PUT','DELETE','OPTIONS','HEAD','PATCH'],
    allowedHeaders: ['Content-Type','Authorization','X-Active-Tenant'],
  });
}

/**
 * PUBLIC_INTERFACE
 * Basic rate limiter for public API.
 */
function rateLimiter() {
  /** This is a public function. */
  return rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });
}

module.exports = {
  helmetMiddleware,
  corsMiddleware,
  rateLimiter,
};
