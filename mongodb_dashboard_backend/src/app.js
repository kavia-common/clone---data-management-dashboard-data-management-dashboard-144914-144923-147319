'use strict';

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const { permissiveCorsMiddleware } = require('./middleware/permissiveCors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const routes = require('./routes');

/**
 * PUBLIC_INTERFACE
 * createApp
 * Returns an Express app with basic security, logging, health route and the main /api router.
 */
function createApp() {
  const app = express();

  // Ensure correct protocol/host behind reverse proxies (needed for accurate OpenAPI server URL)
  app.set('trust proxy', true);

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // CORS
  // For development and Swagger UI usage, enable permissive CORS for API and docs.
  // Note: We intentionally do NOT use credentials with '*' origin to comply with CORS spec.
  // Apply earliest possible to ensure preflight and 4xx/5xx also include headers.
  app.use('/api', permissiveCorsMiddleware);
  app.use('/docs', permissiveCorsMiddleware);
  app.use('/openapi.json', permissiveCorsMiddleware);

  // Explicit OPTIONS handlers for preflight on key mounts to guarantee 204
  app.options('/api/*', permissiveCorsMiddleware, (req, res) => res.status(204).send());
  app.options('/docs', permissiveCorsMiddleware, (req, res) => res.status(204).send());
  app.options('/openapi.json', permissiveCorsMiddleware, (req, res) => res.status(204).send());
  // Fallback catch-all OPTIONS
  app.options('*', cors());

  // Logging
  app.use(morgan('dev'));

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // PUBLIC_INTERFACE
  // Health endpoint that does not require DB or any auth/tenant middleware; fast 200 response
  app.get('/health', (req, res) => {
    res.status(200).json({ ok: true, db: !!req.app.locals.db });
  });

  // PUBLIC_INTERFACE
  // Serve OpenAPI JSON with dynamic servers computed from the request and a stable spec from interfaces/openapi.json
  app.get('/openapi.json', (req, res) => {
    try {
      const specPath = path.join(__dirname, '..', 'interfaces', 'openapi.json');
      const raw = fs.readFileSync(specPath, 'utf8');
      const spec = JSON.parse(raw);

      // Compute server URL dynamically to match preview URL and include /api base for paths
      const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString();
      const hostHeader = (req.headers['x-forwarded-host'] || req.get('host') || '').toString();
      // Some proxies may pass comma-separated hosts; pick the first
      const host = hostHeader.split(',')[0].trim();
      // Our paths in spec already start with /api; keep server as origin without trailing slash
      const origin = `${proto}://${host}`;
      // Ensure swagger uses the same scheme/host as the current request
      spec.servers = [{ url: origin, description: 'Current host (derived)' }];

      // Ensure minimal tags array exists
      if (!spec.tags) spec.tags = [];
      // Add a Docs tag if not present
      if (!spec.tags.find(t => t.name === 'Docs')) {
        spec.tags.push({ name: 'Docs', description: 'Documentation and service metadata' });
      }

      return res.status(200).json(spec);
    } catch (e) {
      // Fallback minimal spec so docs still render
      const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString();
      const hostHeader = (req.headers['x-forwarded-host'] || req.get('host') || '').toString();
      const host = hostHeader.split(',')[0].trim();
      const origin = `${proto}://${host}`;
      return res.status(200).json({
        openapi: '3.0.3',
        info: { title: 'Dashboard API', version: '1.0.0' },
        servers: [{ url: origin }],
        paths: {
          '/health': {
            get: { summary: 'Readiness', responses: { 200: { description: 'OK' } } }
          },
          '/api/health': {
            get: { summary: 'API health', responses: { 200: { description: 'OK' } } }
          }
        }
      });
    }
  });

  // PUBLIC_INTERFACE
  // Mount Swagger UI at /docs using the /openapi.json endpoint
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(null, {
      // Use relative swaggerUrl so it matches current origin and scheme
      swaggerUrl: '/openapi.json',
      explorer: true,
      customSiteTitle: 'Dashboard API Docs',
    })
  );

  // PUBLIC_INTERFACE
  // Web docs usage note for CORS/proxy behavior
  app.get('/docs/usage', (req, res) => {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString();
    const hostHeader = (req.headers['x-forwarded-host'] || req.get('host') || '').toString();
    const host = hostHeader.split(',')[0].trim();
    const origin = `${proto}://${host}`;
    res.status(200).json({
      success: true,
      message: 'Swagger UI is configured to use a dynamic server URL based on the request origin.',
      origin,
      notes: [
        'CORS is configured as non-credentialed with Access-Control-Allow-Origin: * for API and docs.',
        'Preflight OPTIONS requests return 204 with appropriate Allow-Methods and Allow-Headers.',
        'If served behind HTTPS proxy, trust proxy is enabled to preserve scheme for OpenAPI servers.',
      ],
    });
  });

  // Simple root redirect/help so backend preview shows backend info, not frontend
  app.get('/', (req, res) => {
    res.status(200).json({
      message: 'MongoDB Dashboard Backend',
      docs: '/docs',
      openapi: '/openapi.json',
      health: '/health',
      apiHealth: '/api/health',
      cors: {
        mode: 'permissive',
        origin: '*',
        credentials: false,
        appliedTo: ['/api/*', '/docs', '/openapi.json']
      }
    });
  });

  // Main API router
  app.use('/api', routes);

  // Also expose a lightweight health check at /api/health that does not require DB
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, db: !!req.app.locals.db });
  });

  // Basic not found handler (ensure CORS headers already set by route-level middleware)
  app.use((req, res) => {
    if (req.method === 'OPTIONS') {
      return res.status(204).send();
    }
    res.status(404).json({ error: 'Not found' });
  });

  // Basic error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal Server Error' });
  });

  return app;
}

module.exports = { createApp };