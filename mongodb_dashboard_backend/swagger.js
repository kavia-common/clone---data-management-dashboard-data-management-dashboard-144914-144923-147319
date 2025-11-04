const path = require('path');
const fs = require('fs');

/**
 * PUBLIC_INTERFACE
 * mountSwagger
 * Express middleware to mount Swagger UI at /docs and serve OpenAPI spec at /openapi.json.
 * - GET /openapi.json serves the JSON OpenAPI 3 document
 * - GET /docs serves Swagger UI
 * @param {import('express').Application} app Express application instance
 */
function mountSwagger(app) {
  const swaggerUi = require('swagger-ui-express');

  // Load static OpenAPI file
  const specPath = path.join(__dirname, 'interfaces', 'openapi.json');
  let openapiDoc = {};
  try {
    const raw = fs.readFileSync(specPath, 'utf-8');
    openapiDoc = JSON.parse(raw);
  } catch (err) {
    // Fallback minimal document
    openapiDoc = {
      openapi: '3.0.0',
      info: {
        title: 'Dashboard API',
        version: '1.0.0',
        description: 'Auto-generated minimal spec (failed to read interfaces/openapi.json)'
      },
      paths: {}
    };
  }

  // Serve JSON
  app.get('/openapi.json', (req, res) => {
    res.type('application/json').send(openapiDoc);
  });

  // Serve Swagger UI
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc, {
    explorer: true
  }));
}

module.exports = { mountSwagger };
