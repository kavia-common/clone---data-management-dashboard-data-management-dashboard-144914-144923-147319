'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { getBaseOpenApiSpec } = require('../swagger');
const { corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security');
const { permissiveCorsMiddleware } = require('./middleware/permissiveCors');
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
try { console.log('[startup] Applying security and CORS middlewares'); } catch {}
app.use(helmetMiddleware());
// Configure CORS with allowlist and credentials support via our middleware
app.use(corsMiddleware());
// Additionally apply a permissive CORS layer for all /api/* endpoints to ensure broad compatibility (no credentials)
app.use('/api', permissiveCorsMiddleware);
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
    // Use same-origin server so Swagger calls hit this backend instance
    url: `${protocol}://${fullHost}`,
        
    
    // servers: [
    //   {
    //     url:

    //       'https://kavia-dashboard-kavia-dev.cloud.kavia.ai',
    //   },
    // ],
  };
};

app.get('/openapi.json', (req, res) => {
  // Always rebuild from sanitized base spec to avoid stale cache issues at the UI layer
  return res.json(buildDynamicSpec(req));
});
app.get('/api-docs.json', (req, res) => {
  return res.json(buildDynamicSpec(req));
});
// Serve spec at /api/docs.json as well to meet requirement
app.get('/api/docs.json', (req, res) => res.json(buildDynamicSpec(req)));

const swaggerUiHandler = swaggerUi.setup(null, {
  swaggerOptions: {
    url: '/api-docs.json',
    displayRequestDuration: true,
    docExpansion: 'none',
    // Ensure custom header is forwarded by Swagger "Try it out"
    requestInterceptor: (req) => {
      try {
        // If operation defines header parameter x-organization-id, Swagger UI will put it under req.headers automatically when user fills it.
        // As a safety, also copy from common aliases if provided in query to header.
        if (!req.headers) req.headers = {};
        if (req.headers['x-org-id'] && !req.headers['x-organization-id']) {
          req.headers['x-organization-id'] = req.headers['x-org-id'];
        }
        // If user set organization_id query, prefer header
        if (req.loadSpec) return req;
      } catch (e) {}
      return req;
    },
  },
  customSiteTitle: process.env.SWAGGER_TITLE || 'Dashboard API Docs',
  customCss: '.topbar-wrapper .link:after { content: " | Authorize with Bearer token; tenant is implicit (organization_id). If no token, use x-organization-id header."; font-size: 12px; color: #666; }',
});
/**
 * Swagger UI mounting
 * We serve the UI at /api/docs (aliases below). The UI fetches the local spec from /api-docs.json via swaggerOptions.url.
 * Note: This backend does not use any http-proxy-middleware nor webpack dev middleware.
 */
app.use('/api/docs', swaggerUi.serve, swaggerUiHandler);
// Preflight for Swagger UI routes to ensure custom headers are allowed
app.options(['/api/docs', '/docs', '/api-docs', '/api-docs.json', '/openapi.json', '/api/docs/try-it-out/log'], (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept,x-organization-id,x-org-id,x-tenant-id,x-tenant,Origin,User-Agent,Cache-Control,Pragma');
  res.set('Access-Control-Max-Age', '600');
  return res.status(204).send();
});
// Backwards-compatible mounts
app.use('/docs', swaggerUi.serve, swaggerUiHandler);
app.use('/api-docs', swaggerUi.serve, swaggerUiHandler);
// Convenience: health within docs namespace
app.get('/api-docs/health', (req, res) => res.status(200).json({ status: 'ok', via: '/api-docs/health' }));

// PUBLIC_INTERFACE
// GET /api/docs/try-it-out/log
// Logs request method, path, origin, authorization presence, and tenant headers for Swagger Try it out debugging.
// This endpoint does not require auth and is intended only for diagnostics.
app.all('/api/docs/try-it-out/log', (req, res) => {
  const hdrs = {
    origin: req.headers.origin || null,
    authorization_present: !!(req.headers.authorization || req.headers.Authorization),
    authorization_sample: (req.headers.authorization || req.headers.Authorization || '').slice(0, 20) || null,
    'x-organization-id': req.headers['x-organization-id'] || null,
    'x-org-id': req.headers['x-org-id'] || null,
    'x-tenant-id': req.headers['x-tenant-id'] || null,
    'x-tenant': req.headers['x-tenant'] || null,
    'access-control-request-headers': req.headers['access-control-request-headers'] || null,
    'access-control-request-method': req.headers['access-control-request-method'] || null,
  };
  try {
    // eslint-disable-next-line no-console
    console.log('[swagger-try] method=', req.method, 'path=', req.path, 'headers=', hdrs);
  } catch {}
  return res.status(200).json({ success: true, message: 'Logged request headers for Swagger Try it out', headers: hdrs });
});

// Base router (non-/api) for health and overview
const baseRouter = require('./routes');
app.use('/', baseRouter);

/**
 * Simple health with DB status
 */
try { console.log('[startup] Registering GET /api/health, GET /health, and GET /ready'); } catch {}
const healthHandler = (req, res) => {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  const payload = { status: 'ok', db, timestamp: new Date().toISOString() };
  if (db !== 'connected') {
    payload.hint = 'Database not connected. Ensure MONGODB_URI is set in environment (.env).';
  }
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  return res.status(200).json(payload);
};
app.get('/api/health', healthHandler);
/**
 * PUBLIC_INTERFACE
 * GET /health
 * Fast readiness check that does not depend on MongoDB. Returns 200 with status ok and db state.
 */
app.get('/health', (req, res) => {
  return healthHandler(req, res);
});
// Backwards-compat liveness endpoint used by some probes
app.get('/healthz', (req, res) => {
  return healthHandler(req, res);
});
/**
 * PUBLIC_INTERFACE
 * GET /ready
 * Kubernetes-style readiness probe alias to /health for convenience.
 */
app.get('/ready', (req, res) => {
  return healthHandler(req, res);
});
/**
 * PUBLIC_INTERFACE
 * GET /live
 * Liveness probe alias to /health; always 200 with db state.
 */
app.get('/live', (req, res) => {
  return healthHandler(req, res);
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

// Dev utilities
app.use('/api/dev', require('./routes/dev.routes'));

// PUBLIC_INTERFACE
// GET /api/dev/echo
// Echoes Authorization, x-organization-id header, and organization_id/tenant_id query params.
// Useful for validating Swagger Try it out header/query propagation.
app.get('/api/dev/echo', (req, res) => {
  return res.status(200).json({
    authorization: req.headers.authorization || req.headers.Authorization || null,
    x_organization_id: req.headers['x-organization-id'] || null,
    organization_id_query: typeof req.query.organization_id === 'string' ? req.query.organization_id : null,
    tenant_id_query: typeof req.query.tenant_id === 'string' ? req.query.tenant_id : null,
    note: 'For testing Swagger Try it out sends both headers and query params.',
  });
});

// PUBLIC_INTERFACE
// GET /api/dev/echo-headers
// Debug endpoint to echo select headers for verification in Swagger Try it out.
// Returns received x-organization-id, x-tenant-id, authorization presence.
app.get('/api/dev/echo-headers', (req, res) => {
  const hdrs = {
    'x-organization-id': req.headers['x-organization-id'] || null,
    'x-org-id': req.headers['x-org-id'] || null,
    'x-tenant-id': req.headers['x-tenant-id'] || null,
    'x-tenant': req.headers['x-tenant'] || null,
    authorization: !!(req.headers.authorization || req.headers.Authorization),
    origin: req.headers.origin || null,
  };
  return res.status(200).json({ success: true, headers: hdrs });
});

/**
 * Public API routes
 * Users CRUD and analytics summary
 */
try {
  // eslint-disable-next-line no-console
  console.log('[startup] Mounting /api/users routes...');
} catch { }
app.use('/api/users', require('./routes/users.routes'));

try {
  // eslint-disable-next-line no-console
  console.log('[startup] Mounting /api/users tenant-summary routes...');
} catch { }
const usersAnalyticsSummaryRouter = require('./routes/users.analytics.summary.routes');
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
  const debug = process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true';
  if (debug) {
    // Log all swagger try-it-out calls and API calls except auth
    const isSwagger = req.path.startsWith('/api/docs') || req.path.startsWith('/docs') || req.path.startsWith('/api-docs');
    const isApi = req.path.startsWith('/api/') && !req.path.startsWith('/api/auth');
    if (isSwagger || isApi) {
      const authPresent = !!(req.headers?.authorization || req.headers?.Authorization);
      const xtenant = req.headers?.['x-tenant-id'] || req.headers?.['x-tenant'] || null;
      const xorg = req.headers?.['x-organization-id'] || req.headers?.['x-org-id'] || null;
      // eslint-disable-next-line no-console
      console.debug(`[headers] ${req.method} ${req.path} auth=${authPresent ? 'yes' : 'no'} x-org-id=${xorg || 'n/a'} x-tenant-id=${xtenant || 'n/a'} origin=${req.headers.origin || 'n/a'}`);
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

/* LLM costs endpoints */
const { verifyAuth: _verifyAuth } = require('./middleware/verifyAuth');
const { requireTenant: _requireTenant } = require('./middleware/requireTenant');
app.use('/api/llm-costs', _verifyAuth, _requireTenant, require('./routes/llmCosts.routes'));
app.use('/api/llmCosts', _verifyAuth, _requireTenant, require('./routes/llmCosts.routes'));
// Hierarchy analytics for LLM costs
app.use('/api/llm-costs', require('./routes/llmCosts.hierarchy.routes'));

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
  if (!process.env.MONGODB_URI) {
    // eslint-disable-next-line no-console
    console.warn('[startup] MONGODB_URI not set. Starting server without DB connection. API may return 503 for DB-dependent routes.');
  } else {
    connectDB().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to connect to MongoDB on startup:', err.message);
    });
  }
} else {
  // eslint-disable-next-line no-console
  console.log('[startup] Skipping MongoDB connection in test environment');
  try { mongoose.set('bufferCommands', false); } catch { }
}

module.exports = app;