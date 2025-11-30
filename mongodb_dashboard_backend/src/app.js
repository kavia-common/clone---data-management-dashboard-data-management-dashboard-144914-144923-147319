'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { getBaseOpenApiSpec } = require('../swagger');
const { corsMiddleware, helmetMiddleware, rateLimiter } = require('./middleware/security');
const { permissiveCorsMiddleware } = require('./middleware/permissiveCors');
const { connectDB, isDbConnected } = require('./config/db');
const mongoose = require('mongoose');
const { errorHandler } = require('./middleware/standardHandlers');
const cors = require('cors');

const app = express();

// Basic hardening and body parsing
app.set('trust proxy', 1);
app.use(helmetMiddleware());
app.use(corsMiddleware());
app.use('/api', permissiveCorsMiddleware);
app.options('/api/*', cors());
app.use(rateLimiter());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Lightweight response-time header for diagnostics
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    try { res.setHeader('X-Response-Time', String(Date.now() - t0)); } catch {}
  });
  return next();
});

// Dynamic OpenAPI
const buildDynamicSpec = (req) => {
  const host = req.get('host');
  const protocol = req.secure ? 'https' : req.protocol;
  const actualPort = req.socket?.localPort;
  const hasPort = host.includes(':');
  const needsPort = !hasPort && ((protocol === 'http' && actualPort !== 80) || (protocol === 'https' && actualPort !== 443));
  const fullHost = hasPort ? host : `${host}${needsPort ? `:${actualPort}` : ''}`;
  const baseSpec = getBaseOpenApiSpec();
  return {
    ...baseSpec,
    info: {
      ...baseSpec.info,
      title: process.env.SWAGGER_TITLE || baseSpec.info?.title || 'Dashboard API',
      version: process.env.SWAGGER_VERSION || baseSpec.info?.version || '1.0.0',
      description: process.env.SWAGGER_DESCRIPTION || baseSpec.info?.description || 'REST API for Data Management Dashboard with MongoDB and Express',
    },
    url: `${protocol}://${fullHost}`,
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

// Health endpoints
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

// PUBLIC_INTERFACE
// DB readiness endpoint
app.get('/api/db-ready', (req, res) => {
  const connected = isDbConnected();
  res.set('Cache-Control', 'no-store');
  if (!connected) {
    return res.status(503).json({
      success: false,
      status: 'db-not-connected',
      message: 'MongoDB is not connected. Set MONGODB_URI and restart.',
    });
  }
  return res.status(200).json({ success: true, status: 'ok' });
});

// Routers
const safeUse = (path, router) => {
  if (router && typeof router === 'function') { app.use(path, router); }
};

const baseRouter = require('./routes');
safeUse('/api', baseRouter);

// 404 + Error handler
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: 'Not Found',
    path: req.originalUrl,
  });
});
app.use(errorHandler);

// MongoDB Connection (non-blocking)
if (process.env.NODE_ENV !== 'test') {
  if (!process.env.MONGODB_URI) {
    console.warn('[startup] MONGODB_URI not set. Starting without DB connection.');
  } else {
    connectDB().catch((err) =>
      console.error('Failed to connect to MongoDB on startup:', err?.message || err)
    );
  }
} else {
  try { mongoose.set('bufferCommands', false); } catch { }
}

module.exports = app;
