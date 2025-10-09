const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../swagger');
const { corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security');
const { connectDB } = require('./config/db');

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

// Expose OpenAPI JSON (useful for tooling and external consumers)
app.get('/openapi.json', (req, res) => {
  // Inject dynamic server similar to /docs
  const host = req.get('host');
  let protocol = req.protocol;
  const actualPort = req.socket.localPort;
  const hasPort = host.includes(':');
  const needsPort =
    !hasPort &&
    ((protocol === 'http' && actualPort !== 80) ||
      (protocol === 'https' && actualPort !== 443));
  const fullHost = needsPort ? `${host}:${actualPort}` : host;
  protocol = req.secure ? 'https' : protocol;

  const dynamicSpec = {
    ...swaggerSpec,
    info: {
      ...swaggerSpec.info,
      title: process.env.SWAGGER_TITLE || swaggerSpec.info?.title || 'Dashboard API',
      version: process.env.SWAGGER_VERSION || swaggerSpec.info?.version || '1.0.0',
      description:
        process.env.SWAGGER_DESCRIPTION ||
        swaggerSpec.info?.description ||
        'REST API for Data Management Dashboard with MongoDB and Express',
    },
    servers: [{ url: `${protocol}://${fullHost}` }],
  };
  res.json(dynamicSpec);
});

// Swagger UI with dynamic server URL
app.use('/docs', swaggerUi.serve, (req, res, next) => {
  const host = req.get('host');
  let protocol = req.protocol;
  const actualPort = req.socket.localPort;
  const hasPort = host.includes(':');

  const needsPort =
    !hasPort &&
    ((protocol === 'http' && actualPort !== 80) ||
      (protocol === 'https' && actualPort !== 443));
  const fullHost = needsPort ? `${host}:${actualPort}` : host;
  protocol = req.secure ? 'https' : protocol;

  const dynamicSpec = {
    ...swaggerSpec,
    info: {
      ...swaggerSpec.info,
      title: process.env.SWAGGER_TITLE || swaggerSpec.info?.title || 'Dashboard API',
      version: process.env.SWAGGER_VERSION || swaggerSpec.info?.version || '1.0.0',
      description:
        process.env.SWAGGER_DESCRIPTION ||
        swaggerSpec.info?.description ||
        'REST API for Dashboard backed by MongoDB',
    },
    servers: [
      {
        url: `${protocol}://${fullHost}`,
      },
    ],
  };
  swaggerUi.setup(dynamicSpec)(req, res, next);
});

/**
 * Health and base routes
 */
const baseRouter = require('./routes');
app.use('/', baseRouter);

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

// LLM costs endpoints (CRUD/list/get)
app.use('/api/llm-costs', require('./routes/llmCosts.routes'));
app.use('/api/llmCosts', require('./routes/llmCosts.routes'));

// Tenants and Projects (mapping, hierarchy, credits, usage)
app.use('/api/tenants', require('./routes/tenants.routes'));
app.use('/api/projects', require('./routes/projects.routes'));
// Tenants and Projects (mapping, hierarchy, credits, usage)
app.use('/api/tenants', require('./routes/tenants.routes'));

// Analytics endpoints
app.use('/api/analytics', require('./routes/analytics.routes'));

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

// Kick off DB connection once on app startup
connectDB().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to connect to MongoDB on startup:', err.message);
});

module.exports = app;
