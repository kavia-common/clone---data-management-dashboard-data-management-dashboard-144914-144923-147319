const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { getBaseOpenApiSpec } = require('../swagger');
const { corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security');
const { connectDB } = require('./config/db');
const mongoose = require('mongoose');

// Initialize express app
const app = express();

// Trust proxy for proper protocol and IP detection
app.set('trust proxy', true);

// Security middlewares
app.use(helmetMiddleware());
app.use(corsMiddleware());
app.use(rateLimiter());

// Parse JSON request body with sensible limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/**
 * PUBLIC_INTERFACE
 * OpenAPI JSON (primary): GET /openapi.json
 * PUBLIC_INTERFACE
 * OpenAPI JSON alias:    GET /api-docs.json
 *
 * Both endpoints inject a dynamic server URL based on the incoming request,
 * ensuring the documented base path matches the running server (port 3001).
 */
const buildDynamicSpec = (req) => {
  const host = req.get('host');
  let protocol = req.protocol;
  const actualPort = req.socket?.localPort;
  const hasPort = host.includes(':');
  const needsPort =
    !hasPort &&
    ((protocol === 'http' && actualPort !== 80) ||
      (protocol === 'https' && actualPort !== 443));
  const fullHost = needsPort ? `${host}:${actualPort}` : host;
  protocol = req.secure ? 'https' : protocol;

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

// Expose OpenAPI JSON (primary)
app.get('/openapi.json', (req, res) => {
  const dynamicSpec = buildDynamicSpec(req);
  res.json(dynamicSpec);
});

// Expose OpenAPI JSON alias at /api-docs.json for compatibility
app.get('/api-docs.json', (req, res) => {
  const dynamicSpec = buildDynamicSpec(req);
  res.json(dynamicSpec);
});

/**
 * PUBLIC_INTERFACE
 * Swagger UI (primary): GET /docs
 * PUBLIC_INTERFACE
 * Swagger UI alias:     GET /api-docs
 *
 * Serves interactive Swagger UI. Prefer fetching from /openapi.json to avoid inline spec issues.
 * Fallback is ensured by buildDynamicSpec above (and swagger.js sanitization).
 */
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

/**
 * Health and base routes
 */
const baseRouter = require('./routes');
app.use('/', baseRouter);

// In test mode, avoid hanging requests if DB is not connected.
// Return 503 quickly for most /api routes while allowing health, docs, and dev utilities.
if (process.env.NODE_ENV === 'test') {
  try {
    // Disable mongoose buffering so accidental model calls fail fast instead of hanging
    mongoose.set('bufferCommands', false);
  } catch {
    // ignore
  }
  app.use((req, res, next) => {
    const p = req.path || req.originalUrl || '';
    // Paths to bypass: health, openapi, docs, and dev helpers
    const bypass =
      p === '/' ||
      p.startsWith('/health') ||
      p.startsWith('/openapi.json') ||
      p.startsWith('/api-docs.json') ||
      p.startsWith('/docs') ||
      p.startsWith('/api-docs') ||
      p.startsWith('/api/dev');
    if (bypass) return next();

    // For most API calls, if DB isn't connected, return 503 quickly in test mode
    if (mongoose.connection.readyState !== 1) {
      return res
        .status(503)
        .json({ success: false, message: 'Service unavailable: database not connected (test mode)' });
    }
    return next();
  });
}

/**
 * Dev utilities (seed data / db status) - non-auth, for debugging only.
 * Mount under /api/dev
 */
app.use('/api/dev', require('./routes/dev.routes'));

/**
 * Public API routes (no authentication middleware).
 * All collection endpoints are mounted under /api to provide a stable prefix.
 */
app.use('/api/users', require('./routes/users.routes'));

// Provide both kebab-case and camelCase route aliases to match frontend calls
app.use('/api/session-tracking', require('./routes/sessionTracking.routes'));
app.use('/api/sessionTracking', require('./routes/sessionTracking.routes'));

app.use('/api/app-deployments', require('./routes/appDeployments.routes'));
app.use('/api/appDeployments', require('./routes/appDeployments.routes'));

 // Sample data endpoint (demonstration): /api/data
app.use('/api/data', require('./routes/data.routes'));

// Costs aggregate endpoints (custom analytics-like)
app.use('/api/costs', require('./routes/costs.byAgent.routes'));

/**
 * Users analytics (DAU/WAU/MAU and insights)
 */
app.use('/api/users/analytics', require('./routes/users.analytics.metrics.routes'));

// LLM costs endpoints (CRUD/list/get)
app.use('/api/llm-costs', require('./routes/llmCosts.routes'));
app.use('/api/llmCosts', require('./routes/llmCosts.routes'));

 // Tenants and Projects (mapping, hierarchy, credits, usage)
app.use('/api/tenants', require('./routes/tenants.routes'));
app.use('/api/projects', require('./routes/projects.routes'));
app.use('/api/session', require('./routes/session.routes'));

 // Dashboard overview routes
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/dashboard/overview', require('./routes/dashboard.modules.routes'));

// Auth endpoints (login and config health)
app.use('/api/auth', require('./routes/auth.routes'));

 // Analytics endpoints
const analyticsRouter = require('./routes/analytics');
app.use('/api/analytics', analyticsRouter);

// JSON 404 handler for unmatched routes (helps frontend diagnose correctly instead of generic HTML)
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: 'Not Found',
    path: req.originalUrl,
  });
});
// Error handling middleware
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

/* Kick off DB connection once on app startup (skip in tests) */
if (process.env.NODE_ENV !== 'test') {
  connectDB().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to connect to MongoDB on startup:', err.message);
  });
} else {
  // eslint-disable-next-line no-console
  console.log('[startup] Skipping MongoDB connection in test environment');
  try {
    mongoose.set('bufferCommands', false);
  } catch {
    // ignore
  }
}

module.exports = app;
