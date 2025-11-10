'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { getBaseOpenApiSpec } = require('../swagger');
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
} catch { }

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
    servers: [
      {
        url: `${protocol}://${fullHost}`,
        description: 'Current server',
      },
    ],
  };
};

app.get('/openapi.json', (req, res) => {
  try {
    return res.json(buildDynamicSpec(req));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[swagger] Failed to build dynamic spec:', e?.message || e);
    return res.status(200).json({
      openapi: '3.0.0',
      info: {
        title: 'Dashboard API',
        version: '1.0.0',
        description: 'Temporary minimal spec due to spec generation error',
      },
      paths: {},
    });
  }
});
app.get('/api-docs.json', (req, res) => {
  try {
    return res.json(buildDynamicSpec(req));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[swagger] Failed to build dynamic spec:', e?.message || e);
    return res.status(200).json({
      openapi: '3.0.0',
      info: {
        title: 'Dashboard API',
        version: '1.0.0',
        description: 'Temporary minimal spec due to spec generation error',
      },
      paths: {},
    });
  }
});

let swaggerUiHandler;
try {
  swaggerUiHandler = swaggerUi.setup(null, {
    swaggerOptions: {
      url: '/openapi.json',
      displayRequestDuration: true,
      docExpansion: 'none',
    },
    customSiteTitle: process.env.SWAGGER_TITLE || 'Dashboard API Docs',
    customCss:
      '.topbar-wrapper .link:after { content: " | Use x-organization-id header for tenant-scoped endpoints"; font-size: 12px; color: #666; }',
  });
  try { console.log('[startup] Mounting Swagger UI at /docs and /api-docs'); } catch {}
  app.use('/docs', swaggerUi.serve, swaggerUiHandler);
  app.use('/api-docs', swaggerUi.serve, swaggerUiHandler);
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[startup] Swagger UI registration failed, continuing without UI:', e?.message || e);
  // Provide a plain-text fallback so route still responds
  app.get(['/docs', '/api-docs'], (req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send('Swagger UI failed to initialize. OpenAPI is still available at /openapi.json');
  });
}

/**
 * PUBLIC_INTERFACE
 * GET /
 * Minimal root route for quick readiness checks; returns a small JSON payload without DB requirement.
 */
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'ok',
    service: 'mongodb_dashboard_backend',
    docs: '/api-docs',
    health: '/health',
    time: new Date().toISOString(),
  });
});

/**
 * Mount base router
 * Includes lightweight counts and sample routes. Mount under /api to align with OpenAPI tags.
 */
const baseRouter = require('./routes');
app.use('/api', baseRouter);

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

/**
 * PUBLIC_INTERFACE
 * GET /ready
 * Lightweight readiness probe that always returns HTTP 200 to signal the process is alive and bound.
 * This must not depend on any external system (DB, cache, etc.).
 */
app.get('/ready', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'ready',
    service: 'mongodb_dashboard_backend',
    time: new Date().toISOString(),
  });
});

if (process.env.NODE_ENV === 'test') {
  try { mongoose.set('bufferCommands', false); } catch { }
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
 * PUBLIC_INTERFACE
 * GET /api/docs/headers
 * Provides documentation about required headers (x-organization-id) for tenant-scoped endpoints and examples.
 */
app.get('/api/docs/headers', (req, res) => {
  return res.status(200).json({
    title: 'Tenant Header Usage',
    requiredHeader: 'x-organization-id',
    description:
      'For tenant-scoped endpoints such as /api/llm-costs, you must include the x-organization-id header. In Swagger UI, click "Try it out", then add the header under "Headers".',
    examples: [
      {
        endpoint: 'GET /api/llm-costs',
        headers: { 'x-organization-id': 'org_demo' },
      },
      {
        endpoint: 'GET /api/llm-costs/{id}',
        headers: { 'x-organization-id': 'org_demo' },
      },
    ],
  });
});

const { tryRequireRoute, buildStubRouter } = require('./utils/app');

// Dev utilities (guard require)
app.use('/api/dev', tryRequireRoute('./routes/dev.routes', { mountPath: '/api/dev', label: 'dev.routes' }));

/**
 * Public API routes
 * Users CRUD and analytics summary
 */
try {
  // eslint-disable-next-line no-console
  console.log('[startup] Mounting /api/users routes...');
} catch { }
// Guarded user routes
app.use('/api/users', tryRequireRoute('./routes/users.routes', { mountPath: '/api/users', label: 'users.routes' }));

try {
  // eslint-disable-next-line no-console
  console.log('[startup] Mounting /api/users tenant-summary routes...');
} catch { }
// Guarded users.analytics.summary routes
const usersAnalyticsSummaryRouter = tryRequireRoute('./routes/users.analytics.summary.routes', { mountPath: '/api/users', label: 'users.analytics.summary.routes' });
if (usersAnalyticsSummaryRouter && usersAnalyticsSummaryRouter.stack) {
  try {
    // eslint-disable-next-line no-console
    console.log('[startup] users.analytics.summary router loaded with', usersAnalyticsSummaryRouter.stack.length, 'layers');
  } catch { }
}
app.use('/api/users', usersAnalyticsSummaryRouter);

// Inline fallback handler for tenant-summary to avoid 404s if router wiring changes.
// It maps controller output to array [{ tenant, count }] which the frontend expects.
try {
  // eslint-disable-next-line no-console
  console.log('[startup] Registering inline fallback for GET /api/users/tenant-summary');
} catch { }
let getUsersTenantSummarySafe = null;
try {
  ({ getUsersTenantSummary: getUsersTenantSummarySafe } = require('./controllers/users.analytics.summary.controller'));
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[startup] users.analytics.summary.controller failed to load, keeping inline fallback stub only:', e?.message || e);
}
app.get('/api/users/tenant-summary', async (req, res) => {
  if (typeof getUsersTenantSummarySafe !== 'function') {
    return res.status(200).json([]);
  }
  try {
    // Reuse controller but capture its response to map shape
    const fakeRes = {
      _status: 200,
      _sent: false,
      status(code) { this._status = code; return this; },
      json(payload) { this._sent = true; this._payload = payload; return this; }
    };
    await getUsersTenantSummarySafe(req, fakeRes);
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

const analyticsAgentsRoutes = tryRequireRoute('./routes/analyticsAgents', { mountPath: '/api/analytics/agents', label: 'analyticsAgents' });

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

/**
 * Provide both kebab and camelCase aliases for session tracking and deployments (guarded)
 */
app.use('/api/session-tracking', verifyAuth, requireTenant, tryRequireRoute('./routes/sessionTracking.routes', { mountPath: '/api/session-tracking', label: 'sessionTracking.routes' }));
app.use('/api/sessionTracking', verifyAuth, requireTenant, tryRequireRoute('./routes/sessionTracking.routes', { mountPath: '/api/sessionTracking', label: 'sessionTracking.routes' }));

/**
 * Analytics endpoints
 * - Agents cost/usage aggregation
 * - Overview time-bucketed metrics
 */
app.use('/api/analytics/agents', verifyAuth, requireTenant, analyticsAgentsRoutes);
app.use('/api/analytics', verifyAuth, requireTenant, tryRequireRoute('./routes/analytics.overview.routes', { mountPath: '/api/analytics', label: 'analytics.overview.routes' }));

app.use('/api/app-deployments', verifyAuth, requireTenant, tryRequireRoute('./routes/appDeployments.routes', { mountPath: '/api/app-deployments', label: 'appDeployments.routes' }));
app.use('/api/appDeployments', verifyAuth, requireTenant, tryRequireRoute('./routes/appDeployments.routes', { mountPath: '/api/appDeployments', label: 'appDeployments.routes' }));

/**
 * Sample data route removed. The application now only exposes real MongoDB-backed APIs.
 * If needed in the future, reintroduce at /api/data with an actual collection.
 */

// Costs aggregate endpoints (non-users analytics)
app.use('/api/costs', verifyAuth, requireTenant, tryRequireRoute('./routes/costs.byAgent.routes', { mountPath: '/api/costs', label: 'costs.byAgent.routes' }));

/* LLM costs endpoints */
app.use('/api/llm-costs', tryRequireRoute('./routes/llmCosts.routes', { mountPath: '/api/llm-costs', label: 'llmCosts.routes' }));
app.use('/api/llmCosts', tryRequireRoute('./routes/llmCosts.routes', { mountPath: '/api/llmCosts', label: 'llmCosts.routes' }));
// Hierarchy analytics for LLM costs
app.use('/api/llm-costs', tryRequireRoute('./routes/llmCosts.hierarchy.routes', { mountPath: '/api/llm-costs', label: 'llmCosts.hierarchy.routes' }));

// Tenants, Projects, Auth, Session
app.use('/api/tenants', verifyAuth, requireTenant, tryRequireRoute('./routes/tenants.routes', { mountPath: '/api/tenants', label: 'tenants.routes' }));
app.use('/api/projects', verifyAuth, requireTenant, tryRequireRoute('./routes/projects.routes', { mountPath: '/api/projects', label: 'projects.routes' }));
app.use('/api/session', verifyAuth, requireTenant, tryRequireRoute('./routes/session.routes', { mountPath: '/api/session', label: 'session.routes' }));
app.use('/api/dashboard', verifyAuth, requireTenant, tryRequireRoute('./routes/dashboard.routes', { mountPath: '/api/dashboard', label: 'dashboard.routes' }));
app.use('/api/dashboard/overview', verifyAuth, requireTenant, tryRequireRoute('./routes/dashboard.modules.routes', { mountPath: '/api/dashboard/overview', label: 'dashboard.modules.routes' }));
app.use('/api/auth', tryRequireRoute('./routes/auth.routes', { mountPath: '/api/auth', label: 'auth.routes' }));

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
  try { mongoose.set('bufferCommands', false); } catch { }
}

/**
 * PUBLIC_INTERFACE
 * Express application instance for the Dashboard API.
 * This app mounts all middleware, routes, and documentation endpoints.
 * It is imported by src/server.js, which is responsible for binding to a port.
 */
module.exports = app;