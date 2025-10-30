'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { getBaseOpenApiSpec } = require('../swagger');
const { corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security');
const { connectDB } = require('./config/db');
const mongoose = require('mongoose');
const { errorHandler } = require('./middleware/standardHandlers');

const app = express();

// TEMP STARTUP LOGS to trace route mounting (will be removed after verification)
try {
  // eslint-disable-next-line no-console
  console.log('[startup] Initializing Express app for Dashboard API');
} catch {}

app.set('trust proxy', true);
app.use(helmetMiddleware());
app.use(corsMiddleware());
app.use(rateLimiter());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const buildDynamicSpec = (req) => {
  const host = req.get('host');
  let protocol = req.secure ? 'https' : req.protocol;
  const actualPort = req.socket?.localPort;
  const hasPort = host.includes(':');
  const needsPort =
    !hasPort &&
    ((protocol === 'http' && actualPort !== 80) ||
      (protocol === 'https' && actualPort !== 443));
  const fullHost = needsPort ? `${host}:${actualPort}` : host;

  const baseSpec = getBaseOpenApiSpec();
  return {
    ...baseSpec,
    info: {
      ...baseSpec.info,
      title: process.env.SWAGGER_TITLE || baseSpec.info?.title || 'Dashboard API',
      version: process.env.SWAGGER_VERSION || baseSpec.info?.version || '1.0.0',
      description:
        process.env.SWAGGER_DESCRIPTION ||
        baseSpec.info?.description ||
        'REST API for Data Management Dashboard with MongoDB and Express',
    },
    servers: [{ url: `${protocol}://${fullHost}` }],
  };
};

app.get('/openapi.json', (req, res) => res.json(buildDynamicSpec(req)));
app.get('/api-docs.json', (req, res) => res.json(buildDynamicSpec(req)));

const swaggerUiHandler = swaggerUi.setup(null, {
  swaggerOptions: {
    url: '/openapi.json',
    displayRequestDuration: true,
    docExpansion: 'none',
  },
  customSiteTitle: process.env.SWAGGER_TITLE || 'Dashboard API Docs',
});
app.use('/docs', swaggerUi.serve, swaggerUiHandler);
app.use('/api-docs', swaggerUi.serve, swaggerUiHandler);

// Routers
const baseRouter = require('./routes');

/**
 * Simple health with DB status
 */
app.get('/api/health', (req, res) => {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  const payload = { status: 'ok', db };
  if (db !== 'connected') {
    payload.hint = 'Database not connected. Ensure MONGODB_URI is set in environment (.env).';
  }
  return res.status(200).json(payload);
});

if (process.env.NODE_ENV === 'test') {
  try { mongoose.set('bufferCommands', false); } catch {}
  app.use((req, res, next) => {
    const p = req.path || req.originalUrl || '';
    const bypass =
      p === '/' ||
      p.startsWith('/health') ||
      p.startsWith('/openapi.json') ||
      p.startsWith('/api-docs.json') ||
      p.startsWith('/docs') ||
      p.startsWith('/api-docs') ||
      p.startsWith('/api/dev');
    if (bypass) return next();
    if (mongoose.connection.readyState !== 1) {
      return res
        .status(503)
        .json({ success: false, message: 'Service unavailable: database not connected (test mode)' });
    }
    return next();
  });
}

// Dev utilities
app.use('/api/dev', require('./routes/dev.routes'));

/**
 * Public API routes
 * Canonical: mounted once under /api via routes/index.js
 * This centralization prevents duplicates and shadowing.
 */
try { console.log('[startup] Mounting canonical routes under /api'); } catch {}
app.use('/api', baseRouter);

// 404 JSON
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: 'Not Found',
    path: req.originalUrl,
  });
});

app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  connectDB().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to connect to MongoDB on startup:', err.message);
  });
} else {
  // eslint-disable-next-line no-console
  console.log('[startup] Skipping MongoDB connection in test environment');
  try { mongoose.set('bufferCommands', false); } catch {}
}

module.exports = app;
