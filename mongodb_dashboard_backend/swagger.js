'use strict';

/**
 * PUBLIC_INTERFACE
 * setupSwagger
 * Sets up Swagger UI for the provided Express app using the bundled OpenAPI spec.
 * Mounts Swagger UI at /api/docs by default.
 * @param {import('express').Express} app - Express application instance
 * @param {string} [mountPath='/api/docs'] - Optional mount path for Swagger UI
 */
function setupSwagger(app, mountPath = '/api/docs') {
  /** This function sets up Swagger UI with the OpenAPI JSON found in interfaces/openapi.json. */
  const path = require('path');
  const swaggerUi = require('swagger-ui-express');
  const openApiSpec = require(path.join(__dirname, 'interfaces', 'openapi.json'));
  app.use(mountPath, swaggerUi.serve, swaggerUi.setup(openApiSpec, { explorer: true }));
}

module.exports = {
  // PUBLIC_INTERFACE
  setupSwagger,
};
