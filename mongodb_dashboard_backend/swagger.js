'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { getBaseOpenApiSpec } = require('./swagger'); // self-reference safe when required from app.js/server.js

/**
 * PUBLIC_INTERFACE
 * setupSwagger(app)
 * Sets up Swagger UI at /docs with:
 * - persisted bearerAuth support (Authorize button)
 * - requestInterceptor that preserves and forwards custom headers, including x-organization-id
 * - custom title and validatorUrl disabled for air-gapped environments
 */
function setupSwagger(app) {
  const router = express.Router();
  const openapiDocument = getBaseOpenApiSpec();

  // Route to serve the OpenAPI JSON directly too (for convenience in reverse proxies)
  router.get('/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(openapiDocument);
  });

  // Swagger UI
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openapiDocument, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'list',
        validatorUrl: null,
        requestInterceptor: (req) => {
          try {
            // Ensure we do not strip custom headers and we forward x-organization-id if set via parameters
            const headers = req.headers || {};

            // Canonicalize x-organization-id header casing if provided through UI params
            const xOrgHeader =
              headers['x-organization-id'] ||
              headers['X-Organization-Id'] ||
              headers['x-Organization-id'] ||
              headers['X-organization-id'];

            if (xOrgHeader && !headers['x-organization-id']) {
              headers['x-organization-id'] = xOrgHeader;
            }

            // Assign back
            req.headers = headers;
          } catch (_e) {
            // no-op; keep original req
          }
          return req;
        },
      },
      customSiteTitle: 'Dashboard API Docs',
    })
  );

  // Backward compatible mounts commonly used in this project
  app.use('/', router);
  app.use('/api', router); // expose /api/docs and /api/openapi.json as well
}

module.exports = setupSwagger;
