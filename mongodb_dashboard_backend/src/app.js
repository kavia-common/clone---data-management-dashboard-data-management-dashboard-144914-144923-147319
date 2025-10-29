'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { getBaseOpenApiSpec } = require('../swagger');
const { corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security');
const { connectDB } = require('./config/db');
const mongoose = require('mongoose');
const { errorHandler } = require('./middleware/standardHandlers');

const app = express();

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

// Base router (non-/api) for health and overview
const baseRouter = require('./routes');
app.use('/', baseRouter);

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

// Public API routes: mount only core endpoints
app.use('/api/users', require('./routes/users.routes'));

// Provide both kebab and camelCase aliases for session tracking and deployments
app.use('/api/session-tracking', require('./routes/sessionTracking.routes'));
app.use('/api/sessionTracking', require('./routes/sessionTracking.routes'));

app.use('/api/app-deployments', require('./routes/appDeployments.routes'));
app.use('/api/appDeployments', require('./routes/appDeployments.routes'));

// Sample data
app.use('/api/data', require('./routes/data.routes'));

// Costs aggregate endpoints (non-users analytics)
app.use('/api/costs', require('./routes/costs.byAgent.routes'));

// LLM costs endpoints
app.use('/api/llm-costs', require('./routes/llmCosts.routes'));
app.use('/api/llmCosts', require('./routes/llmCosts.routes'));

// Tenants, Projects, Auth, Session
app.use('/api/tenants', require('./routes/tenants.routes'));
app.use('/api/projects', require('./routes/projects.routes'));
app.use('/api/session', require('./routes/session.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/dashboard/overview', require('./routes/dashboard.modules.routes'));
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
