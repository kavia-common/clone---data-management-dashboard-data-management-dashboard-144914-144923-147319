'use strict';

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// Log early
try { console.log('[startup] Initializing Express app for Dashboard API'); } catch {}

// Register ultra-fast health endpoints BEFORE any optional modules or DB
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ status: 'ok', ts: new Date().toISOString() });
});
app.get('/api/health', (req, res) => {
  const ready = mongoose.connection?.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ status: 'ok', db, ts: new Date().toISOString() });
});

// Optional middlewares; guard requires so missing files don’t crash startup
let helmetMiddleware, corsMiddleware, rateLimiter, errorHandler;
try {
  ({ corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security'));
} catch (e) {
  // Fallbacks
  helmetMiddleware = () => (req, res, next) => next();
  corsMiddleware = () => cors();
  rateLimiter = () => (req, res, next) => next();
  try { console.warn('[startup] security middleware not found, using no-op fallbacks'); } catch {}
}
try {
  ({ errorHandler } = require('./middleware/standardHandlers'));
} catch {
  errorHandler = (err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('[error]', err?.message || err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  };
}

app.set('trust proxy', 1);
app.use(helmetMiddleware());
app.use(corsMiddleware());
app.options('/api/*', cors());
app.use(rateLimiter());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Swagger (optional). Guard missing ../swagger or swagger-ui-express gracefully.
try {
  const swaggerUi = require('swagger-ui-express');
  const { getBaseOpenApiSpec } = require('../swagger');
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

    const baseSpec = (typeof getBaseOpenApiSpec === 'function') ? getBaseOpenApiSpec() : { info: {} };
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
} catch (e) {
  try { console.warn('[startup] Swagger disabled (missing modules):', e?.message); } catch {}
}

// Base router; guard require failure to avoid crash
try {
  const baseRouter = require('./routes');
  app.use('/', baseRouter);
} catch (e) {
  try { console.warn('[startup] Base routes unavailable:', e?.message); } catch {}
}

// Dev routes guarded by env
const allowDev =
  (process.env.NODE_ENV !== 'production') ||
  (String(process.env.ALLOW_DEV_ROUTES || '').toLowerCase() === 'true');
if (allowDev) {
  try {
    app.use('/api/dev', require('./routes/dev.routes'));
    console.warn('[routes] Dev routes ENABLED');
  } catch {
    try { console.warn('[routes] Dev routes not available'); } catch {}
  }
} else {
  try { console.warn('[routes] Dev routes DISABLED (set ALLOW_DEV_ROUTES=true to enable)'); } catch {}
}

// Lightweight request logger for dev
const devHeadersLogger = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
    if (req.path.startsWith('/api/') && !req.path.startsWith('/api/auth')) {
      const authPresent = !!(req.headers?.authorization || req.headers?.Authorization);
      const xtenant = req.headers?.['x-tenant-id'] || req.headers?.['x-tenant'] || null;
      // eslint-disable-next-line no-console
      console.debug(`[api] ${req.method} ${req.path} Authorization=${authPresent ? 'yes' : 'no'} x-tenant-id=${xtenant || 'n/a'}`);
    }
  }
  next();
};
app.use(devHeadersLogger);

// 404 JSON
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: 'Not Found',
    path: req.originalUrl,
  });
});

app.use(errorHandler);

// Non-blocking DB connect; tolerant to missing env handled in connectDB
try {
  const { connectDB } = require('./config/db');
  if (process.env.NODE_ENV !== 'test') {
    connectDB().catch((err) => {
      console.error('Failed to connect to MongoDB on startup:', err.message);
    });
  } else {
    console.log('[startup] Skipping MongoDB connection in test environment');
    try { mongoose.set('bufferCommands', false); } catch {}
  }
} catch (e) {
  try { console.warn('[startup] DB module not available:', e?.message); } catch {}
}

module.exports = app;
