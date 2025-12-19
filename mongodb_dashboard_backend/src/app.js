const express = require('express');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const cors = require('cors');
const compression = require('compression');
const mongoose = require('mongoose');

// Load OpenAPI from interfaces/openapi.json (authoritative)
const openApiSpec = require(path.join(__dirname, '..', 'interfaces', 'openapi.json'));

const app = express();

// Middleware
app.set('trust proxy', 1);
app.use(cors());

// Optional response compression
const ENABLE_RESPONSE_COMPRESSION = String(process.env.ENABLE_RESPONSE_COMPRESSION || 'true').toLowerCase() === 'true';
if (ENABLE_RESPONSE_COMPRESSION) {
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compress']) return false;
        return compression.filter(req, res);
      },
    })
  );
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// PUBLIC_INTERFACE
// Health endpoints (stable)
const healthHandler = (req, res) => {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok', service: 'backend', db, timestamp: new Date().toISOString() });
};
app.get(['/api/health', '/health', '/healthz', '/ready', '/live'], healthHandler);

// PUBLIC_INTERFACE
// Root landing should not serve frontend; return minimal JSON with docs hint.
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'ok',
    service: 'backend',
    docs: '/api/docs',
    health: '/api/health',
    timestamp: new Date().toISOString(),
  });
});

// PUBLIC_INTERFACE
// Swagger UI at /api/docs using the bundled OpenAPI spec (static JSON)
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  explorer: true,
  customSiteTitle: process.env.SWAGGER_TITLE || 'Dashboard API Docs',
}));

// IMPORTANT: Do NOT serve frontend statics from this backend.
// If static assets are ever needed, mount only under a namespaced path such as /static.
// Example (disabled):
// app.use('/static', express.static(path.join(__dirname, '..', 'public')));

// Mount API routers if any centralized router exists
try {
  const baseRouter = require('./routes');
  app.use('/api', baseRouter);
} catch (e) {
  // If routes index is not present, ignore; the app still serves health and docs.
}

// 404 JSON
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

module.exports = app;
