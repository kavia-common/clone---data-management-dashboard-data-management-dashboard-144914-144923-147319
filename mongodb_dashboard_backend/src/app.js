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

// ---------------------------------------------
// Middleware
// ---------------------------------------------
app.set('trust proxy', 1);
app.use(helmetMiddleware());
app.use(corsMiddleware());
app.use('/api', permissiveCorsMiddleware);
app.options('/api/*', cors());
app.use(rateLimiter());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------
// Swagger setup
// ---------------------------------------------
const buildDynamicSpec = (req) => {
  const host = req.get('host');
  const protocol = req.secure ? 'https' : req.protocol;
  const actualPort = req.socket?.localPort;
  const hasPort = host.includes(':');
  const needsPort =
    !hasPort &&
    ((protocol === 'http' && actualPort !== 80) ||
      (protocol === 'https' && actualPort !== 443));
  // fullHost is intentionally unused since servers list is predefined.
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
    // url: `${protocol}://${fullHost}`,
    servers: [

      {
        url: 'https://kavia-dashboard-kavia-dev.cloud.kavia.ai',
        description: 'Predefined dev server',
      },
    ],
  };
};


app.get('/openapi.json', (req, res) => res.json(buildDynamicSpec(req)));
app.get('/api-docs.json', (req, res) => res.json(buildDynamicSpec(req)));
app.get('/api/docs.json', (req, res) => res.json(buildDynamicSpec(req)));

const swaggerUiHandler = swaggerUi.setup(null, {
  swaggerOptions: {
    url: '/api-docs.json',
    displayRequestDuration: true,
    docExpansion: 'none',
  },
  customSiteTitle: process.env.SWAGGER_TITLE || 'Dashboard API Docs',
  customCss:
    '.topbar-wrapper .link:after { content: " | Authorize with Bearer token; tenant is implicit (organization_id). If no token, use x-organization-id header."; font-size: 12px; color: #666; }',
});

app.use('/api/docs', swaggerUi.serve, swaggerUiHandler);
app.use('/docs', swaggerUi.serve, swaggerUiHandler);
app.use('/api-docs', swaggerUi.serve, swaggerUiHandler);

// ---------------------------------------------
// Health endpoints
// ---------------------------------------------
const healthHandler = (req, res) => {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  const payload = { status: 'ok', db, timestamp: new Date().toISOString() };
  if (db !== 'connected') {
    payload.hint = 'Database not connected. Ensure MONGODB_URI is set.';
  }
  res.set('Cache-Control', 'no-store');
  return res.status(200).json(payload);
};
app.get(['/api/health', '/health', '/healthz', '/ready', '/live'], healthHandler);

// ---------------------------------------------
// Routers
// ---------------------------------------------
const safeUse = (path, router) => {
  if (router && typeof router === 'function') {app.use(path, router);}
};

const baseRouter = require('./routes');
safeUse('/', baseRouter);

safeUse('/api/dev', require('./routes/dev.routes'));
safeUse('/api/users', require('./routes/users.routes'));
safeUse('/api/users', require('./routes/users.analytics.summary.routes'));

const { getUsersTenantSummary } = require('./controllers/users.analytics.summary.controller');
app.get('/api/users/tenant-summary', async (req, res) => {
  try {
    const fakeRes = {
      _status: 200,
      _sent: false,
      status(code) { this._status = code; return this; },
      json(payload) { this._sent = true; this._payload = payload; return this; },
    };
    await getUsersTenantSummary(req, fakeRes);
    if (!fakeRes._sent) {return res.status(500).json({ success: false, message: 'Controller did not respond' });}
    if (fakeRes._status !== 200) {return res.status(fakeRes._status).json(fakeRes._payload);}
    const items = Array.isArray(fakeRes._payload?.items) ? fakeRes._payload.items : [];
    const mapped = items.map((it) => ({
      tenant: it.tenant_name || it.tenant_id || '',
      count: typeof it.user_count === 'number' ? it.user_count : 0,
    }));
    return res.status(200).json(mapped);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

 // ---------------------------------------------
 // Protected routes (with auth + tenant)
 // ---------------------------------------------
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
    if (req.path.startsWith('/api/') && !req.path.startsWith('/api/auth')) {
      // Developer debug headers (disabled logs)
    }
  }
  next();
});

safeUse('/api/session-tracking', require('./routes/sessionTracking.routes'));
safeUse('/api/sessionTracking', require('./routes/sessionTracking.routes'));
safeUse('/api/analytics/agents', require('./routes/analyticsAgents'));
safeUse('/api/analytics', require('./routes/analytics.overview.routes'));
safeUse('/api/app-deployments', require('./routes/appDeployments.routes'));
safeUse('/api/appDeployments', require('./routes/appDeployments.routes'));
safeUse('/api/costs', require('./routes/costs.byAgent.routes'));
safeUse('/api/llm-costs', require('./routes/llmCosts.routes'));
safeUse('/api/llm-costs', require('./routes/llmCosts.hierarchy.routes'));
safeUse('/api/tenants', require('./routes/tenants.routes'));
safeUse('/api/projects', require('./routes/projects.routes'));
safeUse('/api/session', require('./routes/session.routes'));
safeUse('/api/dashboard', require('./routes/dashboard.routes'));
safeUse('/api/dashboard/overview', require('./routes/dashboard.modules.routes'));
safeUse('/api/auth', require('./routes/auth.routes'));

// ---------------------------------------------
// 404 + Error handler
// ---------------------------------------------
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: 'Not Found',
    path: req.originalUrl,
  });
});
app.use(errorHandler);

// ---------------------------------------------
// MongoDB Connection
// ---------------------------------------------
if (process.env.NODE_ENV !== 'test') {
  if (!process.env.MONGODB_URI) {
    console.warn('[startup] MONGODB_URI not set. Starting without DB connection.');
  } else {
    connectDB().catch((err) =>
      console.error('Failed to connect to MongoDB on startup:', err.message)
    );
  }
} else {
  try { mongoose.set('bufferCommands', false); } catch { }
}

module.exports = app;