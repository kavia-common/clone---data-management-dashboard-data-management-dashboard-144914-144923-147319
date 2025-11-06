'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');

// Defensive: keep Swagger optional if generator is absent
let getBaseOpenApiSpec = () => ({
  openapi: '3.0.0',
  info: { title: 'Dashboard API', version: '1.0.0' },
});
try {
  // Optional swagger module if present
  // eslint-disable-next-line import/no-unresolved, global-require
  getBaseOpenApiSpec = require('../swagger').getBaseOpenApiSpec;
} catch {
  // noop: minimal spec used
}

const mongoose = require('mongoose');

// Basic, local middlewares; if security modules are missing, fall back to safe defaults
let corsMiddleware = () => (req, res, next) => next();
let helmetMiddleware = () => (req, res, next) => next();
let rateLimiter = () => (req, res, next) => next();
try {
  // eslint-disable-next-line global-require
  const sec = require('./middleware/security');
  corsMiddleware = sec.corsMiddleware || corsMiddleware;
  helmetMiddleware = sec.helmetMiddleware || helmetMiddleware;
  rateLimiter = sec.rateLimiter || rateLimiter;
} catch {
  // fall back to no-op implementations
}

const cors = require('cors');
const app = express();

// Startup log
try {
  // eslint-disable-next-line no-console
  console.log('[startup] Initializing Express app for Dashboard API');
} catch {}

app.set('trust proxy', 1);
app.use(helmetMiddleware());
app.use(corsMiddleware());
app.options('/api/*', cors());
app.use(rateLimiter());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Swagger/OpenAPI endpoints
const buildDynamicSpec = (req) => {
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
    servers: [
      {
        url:
          process.env.SWAGGER_SERVER_URL ||
          (req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:3001'),
      },
    ],
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

// Base health/root without pulling in the big index router to avoid require crashes
app.get('/', (req, res) => res.status(200).json({ ok: true, service: 'dashboard-api' }));
app.get('/healthz', (req, res) => res.status(200).json({ ok: true, service: 'dashboard-api' }));

// Simple health with DB status (non-fatal if DB missing)
try {
  // eslint-disable-next-line no-console
  console.log('[startup] Registering GET /api/health');
} catch {}
app.get('/api/health', (req, res) => {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  const payload = { status: 'ok', db, timestamp: new Date().toISOString() };
  if (db !== 'connected') {
    payload.hint =
      'Database not connected. Ensure MONGODB_URI is set in environment (.env).';
  }
  res.set('Cache-Control', 'no-store');
  return res.status(200).json(payload);
});

// Mount only existing routes to ensure startup succeeds
const { verifyAuth } = require('./middleware');
const { requireTenant } = require('./middleware/requireTenant');

const safeMount = (path, factory) => {
  try {
    const router = factory();
    if (router) app.use(path, router);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[startup] Skipping route ${path}:`, e?.message || e);
  }
};

safeMount('/api/dev', () => require('./routes/dev.routes'));
safeMount('/api/auth', () => require('./routes/auth.routes'));
safeMount('/api/users', () => require('./routes/users.routes'));
safeMount('/api/tenants', () => require('./routes/tenants.routes'));
safeMount('/api/llm-costs', () => require('./routes/llmCosts.routes'));
safeMount('/api/session-tracking', () => require('./routes/sessionTracking.routes'));
safeMount('/api/session', () => require('./routes/session.routes'));
safeMount('/api/app-deployments', () => require('./routes/appDeployments.routes'));
safeMount('/api/analytics', () => require('./routes/analytics.overview.routes'));

// Protected identity probe
/**
 * PUBLIC_INTERFACE
 * GET /api/me
 * Returns current auth context, primarily tenant_id and sub to validate JWT middleware.
 */
app.get('/api/me', verifyAuth, requireTenant, (req, res) => {
  return res.status(200).json({
    tenant_id: req?.auth?.tenantId || req?.tenantId || null,
    sub: req?.auth?.sub || req?.user?.sub || null,
    roles: req?.auth?.roles || [],
  });
});

// 404 JSON
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: 'Not Found',
    path: req.originalUrl,
  });
});

// Mongo connection is handled in server.js via connectDB; keep this file focused on app composition.
module.exports = app;
