const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

/**
 * Swagger/OpenAPI: UI and JSON routes
 * - UI: /api/docs (aliases: /api-docs, /docs)
 * - JSON: /api/docs.json (aliases: /api-docs.json, /openapi.json)
 */
try {
  const path = require('path');
  const swaggerUi = require('swagger-ui-express');
  const { getBaseOpenApiSpec } = require('../swagger');

  // PUBLIC_INTERFACE
  function buildServersForCurrentOrigin(req) {
    // Build servers dynamically so Try-It-Out targets the same backend origin/host
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseUrl = `${proto}://${host}`;
    return [{ url: baseUrl }];
  }

  // PUBLIC_INTERFACE
  function getSpecWithServers(req) {
    const spec = { ...getBaseOpenApiSpec() };
    // avoid mutating cached spec
    spec.servers = buildServersForCurrentOrigin(req);
    return spec;
  }

  // Serve OpenAPI JSON (primary)
  app.get(['/api/docs.json', '/api-docs.json', '/openapi.json'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json(getSpecWithServers(req));
  });

  // Helper endpoint to explain headers for Try It Out
  app.get('/api/docs/headers', (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      note: 'Most tenant-scoped endpoints require x-organization-id when Authorization is not provided.',
      example: { header: 'x-organization-id: org_demo' },
    });
  });

  // Swagger UI (primary mount at /api/docs)
  const swaggerUiOpts = {
    explorer: true,
    swaggerOptions: {
      // Point to our JSON route to avoid CORS mismatch
      url: '/api/docs.json',
      displayRequestDuration: true,
      docExpansion: 'none',
    },
  };
  app.use('/api/docs', swaggerUi.serve, (req, res, next) => {
    // ensure dynamic servers in UI if needed
    return swaggerUi.setup(getSpecWithServers(req), swaggerUiOpts)(req, res, next);
  });

  // Aliases
  app.use('/api-docs', (req, res) => res.redirect(302, '/api/docs'));
  app.use('/docs', (req, res) => res.redirect(302, '/api/docs'));
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[swagger] Docs not mounted:', e?.message || e);
}

/**
 * Mount consolidated API router
 * src/routes/index.js already wires up all core routes with proper middleware.
 */
const apiRouter = require('./routes/index');
app.use('/api', apiRouter);

/**
 * session-tracking proxy has been removed; frontend calls the external API directly now.
 * Intentionally not mounting ./routes/proxy.sessionTracking
 */

// Health endpoints (simple readiness/liveness)
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/ready', (req, res) => res.json({ ready: true }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

module.exports = app;
