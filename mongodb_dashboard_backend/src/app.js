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

// Stability-first settings
app.disable('x-powered-by');

// ---------------------------------------------
// Middleware
// ---------------------------------------------
app.set('trust proxy', 1);
app.use(helmetMiddleware());
app.use(corsMiddleware());
app.use('/api', permissiveCorsMiddleware);
app.options('/api/*', cors());
app.use(rateLimiter());
app.use(express.json({ limit: process.env.JSON_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Early heartbeat middleware: if a response takes >10s to start, flush headers.
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 10000);
app.use((req, res, next) => {
  let headersSent = false;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      headersSent = true;
      res.setHeader('X-Heartbeat', 'true');
      res.setHeader('Cache-Control', 'no-store');
      if (res.flushHeaders) {
        res.flushHeaders();
      }
    }
  }, HEARTBEAT_MS);
  const clear = () => clearTimeout(timer);
  res.on('finish', clear);
  res.on('close', clear);
  res.on('error', clear);
  req._heartbeatTimerStartedAt = Date.now();
  req._heartbeatHeadersSent = () => headersSent;
  next();
});

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
  const fullHost = hasPort ? host : `${host}${needsPort ? `:${actualPort}` : ''}`;
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
    url: `${protocol}://${fullHost}`,
  };
};

app.get('/openapi.json', (req, res) => res.json(buildDynamicSpec(req)));
app.get('/api-docs.json', (req, res) => res.json(buildDynamicSpec(req)));

// PUBLIC_INTERFACE
// WebSocket usage helper (no active WS endpoints). Provides project-level note in docs.
app.get('/api/websocket-usage', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'No WebSocket endpoints are currently exposed. The API supports HTTP streaming for long-running endpoints like /api/llm-costs by sending early headers to avoid upstream timeouts.',
    examples: [
      { method: 'GET', path: '/api/llm-costs', note: 'Streams headers early to keep the connection alive before DB queries finish.' }
    ]
  });
});
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
try {
  // Mark a header on all API requests to help detect multiple proxying/double route handling
  app.use('/api', (req, res, next) => {
    try { res.set('X-Router-Pass', String((Number(res.getHeader('X-Router-Pass')) || 0) + 1)); } catch (_) {}
    next();
  });
} catch (_) {}

// Proactively ensure critical indexes for LLMCosts to avoid collection scans on list/sort
try {
  const LLMCost = require('./models/llmCosts.model');
  if (LLMCost?.ensureIndexes) {
    LLMCost.ensureIndexes()
      .then(() => { try { console.log('[startup] LLMCost indexes ensured'); } catch (_) {} })
      .catch(() => {});
  }
} catch (_) {}

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
safeUse('/api/analytics', require('./routes/analytics'));
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
