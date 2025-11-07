'use strict';

/**
 * PUBLIC_INTERFACE
 * getBaseOpenApiSpec
 * Returns a minimal OpenAPI 3.0 spec object that src/app.js augments dynamically per request.
 * This base spec includes app-level metadata and tags; routes enrich the paths via JSDoc or are served dynamically.
 *
 * Notes:
 * - Do NOT hardcode environment-specific URLs here. src/app.js computes servers based on the request.
 * - Keep this function side-effect free; it is imported by app.js during startup.
 */
function getBaseOpenApiSpec() {
  const title = process.env.SWAGGER_TITLE || 'Dashboard API';
  const description =
    process.env.SWAGGER_DESCRIPTION ||
    'REST API for Data Management Dashboard with MongoDB and Express';
  const version = process.env.SWAGGER_VERSION || '1.0.0';

  return {
    openapi: '3.0.3',
    info: {
      title,
      description,
      version,
      contact: {
        name: 'Dashboard API',
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication and session endpoints' },
      { name: 'Users', description: 'Users collection endpoints' },
      { name: 'Tenants', description: 'Tenant (organization) endpoints' },
      { name: 'Analytics', description: 'Analytics and aggregations' },
      { name: 'LLMCosts', description: 'LLM usage cost records endpoints' },
      { name: 'AppDeployments', description: 'Application deployments endpoints' },
      { name: 'Dashboard', description: 'Dashboard overview endpoints' },
      { name: 'Dev', description: 'Development utilities (guarded)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Include a Bearer JWT with tenantId claim. All protected endpoints are tenant-scoped server-side.',
        },
      },
      schemas: {
        // Minimal placeholders so UI renders; detailed schemas can be added by generators
        GenericDocument: { type: 'object', additionalProperties: true },
        ListEnvelope: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/GenericDocument' },
            },
            meta: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
        Health: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            db: { type: 'string', enum: ['connected', 'connecting', 'disconnected'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      // Keep a couple of base paths documented; others are described in route-level swagger JSDoc
      '/health': {
        get: {
          summary: 'Readiness health check',
          description:
            'Fast readiness check that does not depend on MongoDB. Always returns 200 with current db state.',
          tags: ['Dev'],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Health' },
                },
              },
            },
          },
        },
      },
      '/api/health': {
        get: {
          summary: 'API health check',
          description:
            'Same payload as /health; safe for monitoring. Includes db connection state.',
          tags: ['Dev'],
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Health' },
                },
              },
            },
          },
        },
      },
    },
  };
}

module.exports = { getBaseOpenApiSpec };
