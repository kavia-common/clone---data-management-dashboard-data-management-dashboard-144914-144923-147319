'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
// Load swagger base spec safely; fallback to a minimal spec if module path changes
let getBaseOpenApiSpec = () => ({
  openapi: '3.0.0',
  info: {
    title: 'Dashboard API',
    version: '1.0.0',
    description: 'REST API for Data Management Dashboard with MongoDB and Express',
  },
  paths: {},
  tags: [],
});
try {
  // swagger.js is at project root of the backend container (../.. from src)
  // Attempt multiple resolution strategies to avoid require-time crash.
  // Primary: root-level swagger.js (one directory up from src is project root? Here backend root contains swagger.js)
  // from src/app.js, backend root is "..", so "../swagger.js"
  // Try both without and with extension.
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const swaggerModule = require('../swagger');
  if (swaggerModule && typeof swaggerModule.getBaseOpenApiSpec === 'function') {
    getBaseOpenApiSpec = swaggerModule.getBaseOpenApiSpec;
  }
} catch (e1) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const swaggerModule2 = require('../../swagger');
    if (swaggerModule2 && typeof swaggerModule2.getBaseOpenApiSpec === 'function') {
      getBaseOpenApiSpec = swaggerModule2.getBaseOpenApiSpec;
    }
  } catch (e2) {
    try { console.warn('[startup] Swagger module not found; using minimal in-memory OpenAPI spec.'); } catch {}
  }
}
const { corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security');
const { connectDB } = require('./config/db');
const mongoose = require('mongoose');
const { errorHandler } = require('./middleware/standardHandlers');
const cors = require('cors');

const app = express();

// TEMP STARTUP LOGS to trace route mounting (will be removed after verification)
try {
  // eslint-disable-next-line no-console
  console.log('[startup] Initializing Express app for Dashboard API');
} catch {}

app.set('trust proxy', 1); // only trust local proxies
app.use(helmetMiddleware());
// Configure CORS with allowlist and credentials support via our middleware
app.use(corsMiddleware());
// Handle preflight across API routes explicitly to avoid 404 on OPTIONS
app.options('/api/*', cors()); // uses default which will be overridden by corsMiddleware above
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
    // servers: [{ url: `${protocol}://${fullHost}` }],
    servers: [
  {
    url:
      process.env.SWAGGER_SERVER_URL ||
      'https://kavia-dashboard-kavia-dev.cloud.kavia.ai',
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

// Base router (non-/api) for health and overview
const baseRouter = require('./routes');
app.use('/', baseRouter);

/**
 * Simple health with DB status
 */
try { console.log('[startup] Registering GET /api/health and GET /health'); } catch {}
const healthHandler = (req, res) => {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  const payload = { status: 'ok', db, timestamp: new Date().toISOString() };
  if (db !== 'connected') {
    payload.hint = 'Database not connected. Ensure MONGODB_URI is set in environment (.env).';
  }
  res.set('Cache-Control', 'no-store');
  return res.status(200).json(payload);
};
app.get('/api/health', healthHandler);
/**
 * PUBLIC_INTERFACE
 * GET /health
 * Fast readiness check that does not depend on MongoDB. Returns 200 with status ok and db state.
 */
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return healthHandler(req, res);
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

/**
 * Dev utilities (guarded)
 * Only mount when NODE_ENV !== 'production' or explicit ALLOW_DEV_ROUTES === 'true'
 */
const allowDev =
  (process.env.NODE_ENV !== 'production') ||
  (String(process.env.ALLOW_DEV_ROUTES || '').toLowerCase() === 'true');
if (allowDev) {
  try { console.warn('[routes] Dev routes ENABLED'); } catch {}
  app.use('/api/dev', require('./routes/dev.routes'));
} else {
  try { console.warn('[routes] Dev routes DISABLED (set ALLOW_DEV_ROUTES=true to enable)'); } catch {}
}

/**
 * Public API routes
 * Users CRUD and analytics summary
 */
try {
  // eslint-disable-next-line no-console
  console.log('[startup] Mounting /api/users routes...');
} catch {}
app.use('/api/users', require('./routes/users.routes'));

try {
  // eslint-disable-next-line no-console
  console.log('[startup] Mounting /api/users tenant-summary routes...');
} catch {}
const usersAnalyticsSummaryRouter = require('./routes/users.analytics.summary.routes');
if (usersAnalyticsSummaryRouter && usersAnalyticsSummaryRouter.stack) {
  try {
    // eslint-disable-next-line no-console
    console.log('[startup] users.analytics.summary router loaded with', usersAnalyticsSummaryRouter.stack.length, 'layers');
  } catch {}
}
app.use('/api/users', usersAnalyticsSummaryRouter);

// Inline fallback handler for tenant-summary to avoid 404s if router wiring changes.
// It maps controller output to array [{ tenant, count }] which the frontend expects.
try {
  // eslint-disable-next-line no-console
  console.log('[startup] Registering inline fallback for GET /api/users/tenant-summary');
} catch {}
const { getUsersTenantSummary } = require('./controllers/users.analytics.summary.controller');
app.get('/api/users/tenant-summary', async (req, res) => {
  try {
    // Reuse controller but capture its response to map shape
    const fakeRes = {
      _status: 200,
      _sent: false,
      status(code) { this._status = code; return this; },
      json(payload) { this._sent = true; this._payload = payload; return this; }
    };
    await getUsersTenantSummary(req, fakeRes);
    if (!fakeRes._sent) {
      return res.status(500).json({ success: false, message: 'Controller did not respond' });
    }
    if (fakeRes._status !== 200) {
      return res.status(fakeRes._status).json(fakeRes._payload);
    }
    const items = Array.isArray(fakeRes._payload?.items) ? fakeRes._payload.items : [];
    const mapped = items.map((it) => ({
      tenant: it.tenant_name || it.tenant_id || '',
      count: typeof it.user_count === 'number' ? it.user_count : 0,
    }));
    return res.status(200).json(mapped);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tenant-summary.inline] error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

const analyticsAgentsRoutes = require('./routes/analyticsAgents');

const { verifyAuth } = require('./middleware/verifyAuth');
const { requireTenant } = require('./middleware/requireTenant');

/**
 * Add a thin logger to confirm headers for protected API calls in development.
 */
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

// Provide both kebab and camelCase aliases for session tracking and deployments
app.use('/api/session-tracking', verifyAuth, requireTenant, require('./routes/sessionTracking.routes'));
app.use('/api/sessionTracking', verifyAuth, requireTenant, require('./routes/sessionTracking.routes'));

/**
 * Analytics endpoints
 * - Agents cost/usage aggregation
 * - Overview time-bucketed metrics
 */
app.use('/api/analytics/agents', verifyAuth, requireTenant, analyticsAgentsRoutes);
app.use('/api/analytics', verifyAuth, requireTenant, require('./routes/analytics.overview.routes'));

app.use('/api/app-deployments', verifyAuth, requireTenant, require('./routes/appDeployments.routes'));
app.use('/api/appDeployments', verifyAuth, requireTenant, require('./routes/appDeployments.routes'));

/**
 * Sample data route removed. The application now only exposes real MongoDB-backed APIs.
 * If needed in the future, reintroduce at /api/data with an actual collection.
 */

// Costs aggregate endpoints (non-users analytics)
app.use('/api/costs', verifyAuth, requireTenant, require('./routes/costs.byAgent.routes'));

// LLM costs endpoints
app.use('/api/llm-costs', verifyAuth, requireTenant, require('./routes/llmCosts.routes'));
app.use('/api/llmCosts', verifyAuth, requireTenant, require('./routes/llmCosts.routes'));

// Tenants, Projects, Auth, Session
app.use('/api/tenants', verifyAuth, requireTenant, require('./routes/tenants.routes'));
app.use('/api/projects', verifyAuth, requireTenant, require('./routes/projects.routes'));
app.use('/api/session', verifyAuth, requireTenant, require('./routes/session.routes'));
app.use('/api/dashboard', verifyAuth, requireTenant, require('./routes/dashboard.routes'));
app.use('/api/dashboard/overview', verifyAuth, requireTenant, require('./routes/dashboard.modules.routes'));
app.use('/api/auth', require('./routes/auth.routes'));

/* Users analytics routes have been fully removed to avoid dangling references */

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
