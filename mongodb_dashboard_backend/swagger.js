'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');

/**
 * PUBLIC_INTERFACE
 * setupSwagger(app)
 * Sets up Swagger UI and OpenAPI JSON routes:
 * - Serves OpenAPI at /openapi.json and /api/openapi.json
 * - Serves Swagger UI at /api/docs and /docs
 * - Uses a single spec source via swaggerOptions.url to avoid "attribute url is unexpected"
 * - Keeps requestInterceptor to normalize and forward x-organization-id
 * - Persists Authorization across page reloads
 */
function setupSwagger(app) {
  const router = express.Router();

  // Serve the OpenAPI document from interfaces/openapi.json
  // We load it once at startup and reuse the same object.
  let openapiDocument;
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    openapiDocument = require('./interfaces/openapi.json');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[swagger] Failed to load interfaces/openapi.json:', e?.message || e);
    openapiDocument = {
      openapi: '3.0.0',
      info: { title: 'Dashboard API', version: '1.0.0', description: 'OpenAPI document not found.' },
      paths: {},
    };
  }

  // Route to serve the OpenAPI JSON directly
  router.get('/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(openapiDocument);
  });

  // Swagger UI:
  // IMPORTANT: pass only 'url' via swaggerOptions and do not pass 'spec' simultaneously.
  // Using url=/openapi.json guarantees a single source of truth and shows the Authorize button
  // when components.securitySchemes.bearerAuth is present (as defined in interfaces/openapi.json).
  const uiHandler = swaggerUi.setup(null, {
    swaggerOptions: {
      url: '/openapi.json',
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      validatorUrl: null,
      requestInterceptor: (req) => {
        try {
          if (!req.headers) req.headers = {};
          const headers = req.headers;

          // Canonicalize x-organization-id header casing if provided through UI params
          const xOrgHeader =
            headers['x-organization-id'] ||
            headers['X-Organization-Id'] ||
            headers['x-Organization-id'] ||
            headers['X-organization-id'] ||
            headers['x-org-id'] ||
            headers['X-Org-Id'];

          if (xOrgHeader && !headers['x-organization-id']) {
            headers['x-organization-id'] = xOrgHeader;
          }

          // If the user provided tenant in query, mirror to header for server-side scoping
          if (!headers['x-organization-id'] && req.url && req.url.includes('?')) {
            const q = new URLSearchParams(req.url.split('?')[1]);
            const qOrg = q.get('organization_id') || q.get('tenant_id');
            if (qOrg) headers['x-organization-id'] = qOrg;
          }
        } catch (_e) {
          // no-op; keep original req
        }
        return req;
      },
    },
    customSiteTitle: 'Dashboard API Docs',
  });

  // Mount UI at /docs and /api/docs
  router.use('/docs', swaggerUi.serve, uiHandler);

  // Backward compatible mounts and top-level mounts
  app.use('/', router);
  app.use('/api', router); // exposes /api/docs and /api/openapi.json as well
}

module.exports = setupSwagger;
