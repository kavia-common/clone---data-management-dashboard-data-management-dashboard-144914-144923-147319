'use strict';

const fs = require('fs');
const path = require('path');
const swaggerJSDoc = require('swagger-jsdoc');

/** Build the reusable components injected into any loaded spec */
function buildCommonComponents() {
  return {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Provide a Bearer token obtained from POST /api/auth/login. Token includes organization_id (a.k.a tenant_id) implicitly. When Authorization is present and valid, tenant scope is resolved from the JWT; x-organization-id header is not required.'
      }
    },
    parameters: {
      xOrganizationId: {
        name: 'x-organization-id',
        in: 'header',
        required: false,
        schema: { type: 'string' },
        description:
          'Tenant identifier for tenant-scoped endpoints. Required when Authorization is not provided. If Authorization Bearer token is provided, tenant is resolved implicitly from the JWT (organization_id/tenant_id) and this header becomes optional. For testing without Authorization, include this header or use query ?tenant_id / ?organization_id.'
      },
    },
    schemas: {
      GenericDocument: {
        type: 'object',
        description: 'A generic MongoDB document with flexible fields',
        additionalProperties: true,
        properties: {
          _id: { type: 'string', description: 'MongoDB ObjectId as string' },
        },
      },
      ListEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/GenericDocument' },
          },
          meta: {
            type: 'object',
            properties: {
              page: { type: 'integer', example: 1 },
              limit: { type: 'integer', example: 20 },
              total: { type: 'integer', example: 42 },
            },
          },
        },
      },
    },
  };
}

/** Create a Swagger spec from JSDoc annotations as a fallback. */
function buildJsDocSpec() {
  const options = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: process.env.SWAGGER_TITLE || 'Dashboard API',
        version: process.env.SWAGGER_VERSION || '1.0.0',
        description:
          process.env.SWAGGER_DESCRIPTION ||
          'REST API for Data Management Dashboard with MongoDB and Express',
      },
      components: buildCommonComponents(),
      security: [{ bearerAuth: [] }],
    },
    // Scan backend src for @swagger JSDoc blocks
    apis: [
      path.resolve(__dirname, 'src', 'routes', '**', '*.js'),
      path.resolve(__dirname, 'src', 'routes', '*.js'),
      path.resolve(__dirname, 'src', 'controllers', '**', '*.js'),
      path.resolve(__dirname, 'src', 'controllers', '*.js'),
    ],
  };
  return swaggerJSDoc(options);
}

/**
 * Sanitize an OpenAPI document object:
 * - Ensure "paths" contains only keys that start with '/'
 * - Ensure "openapi" and "info" are present
 * - Ensure reusable parameters/schemas are present
 */
function sanitizeOpenApiDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;

  // Remove invalid path keys (Swagger UI will break on these)
  let hasAnyValidPath = false;
  if (doc.paths && typeof doc.paths === 'object') {
    const validPaths = {};
    Object.entries(doc.paths).forEach(([key, val]) => {
      if (typeof key === 'string' && key.startsWith('/')) {
        validPaths[key] = val;
        hasAnyValidPath = true;
      }
      // Drop invalid keys silently
    });
    doc.paths = validPaths;
  } else {
    doc.paths = {};
  }

  if (!hasAnyValidPath) {
    return null;
  }

  if (!doc.openapi) {
    doc.openapi = '3.0.0';
  }
  if (!doc.info) {
    doc.info = {
      title: process.env.SWAGGER_TITLE || 'Dashboard API',
      version: process.env.SWAGGER_VERSION || '1.0.0',
      description:
        process.env.SWAGGER_DESCRIPTION ||
        'REST API for Data Management Dashboard with MongoDB and Express',
    };
  }

  // Inject common components if absent
  doc.components = doc.components || {};
  doc.components.parameters = { ...(doc.components.parameters || {}) };
  doc.components.schemas = { ...(doc.components.schemas || {}) };
  doc.components.securitySchemes = { ...(doc.components.securitySchemes || {}) };
  const commons = buildCommonComponents();
  // Merge securitySchemes
  doc.components.securitySchemes.bearerAuth =
    doc.components.securitySchemes.bearerAuth || commons.securitySchemes.bearerAuth;
  // Merge header parameter
  doc.components.parameters.xOrganizationId =
    doc.components.parameters.xOrganizationId || commons.parameters.xOrganizationId;
  // Merge schemas
  doc.components.schemas.GenericDocument =
    doc.components.schemas.GenericDocument || commons.schemas.GenericDocument;
  doc.components.schemas.ListEnvelope =
    doc.components.schemas.ListEnvelope || commons.schemas.ListEnvelope;

  // Set global security so Swagger UI shows Authorize button and applies bearer by default
  doc.security = doc.security || [{ bearerAuth: [] }];

  // Ensure servers is set to relative root so that Swagger UI uses same-origin calls
  // This avoids cross-origin CORS issues when docs are hosted under the backend.
  doc.servers = [{ url: '/' }];

  // Validate it serializes
  try {
    JSON.stringify(doc);
  } catch {
    return null;
  }

  return doc;
}

// Cache result to avoid re-reading on every request
let cachedSpec = null;

/**
 * PUBLIC_INTERFACE
 * getBaseOpenApiSpec
 * Returns a valid OpenAPI document. Prefers interfaces/openapi.json (sanitized)
 * and falls back to the JSDoc-generated spec if necessary.
 */
function getBaseOpenApiSpec() {
  if (cachedSpec) return cachedSpec;

  // Attempt to load interfaces/openapi.json (preferred)
  try {
    const filePath = path.resolve(__dirname, 'interfaces', 'openapi.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeOpenApiDoc(parsed);
    if (sanitized) {
      cachedSpec = sanitized;
      return cachedSpec;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[swagger] Could not load interfaces/openapi.json, falling back to JSDoc.', err?.message);
  }

  // Fallback to JSDoc-generated spec
  try {
    cachedSpec = buildJsDocSpec();
    return cachedSpec;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[swagger] Failed to build JSDoc spec:', err);
    // Final fallback: minimal valid spec to avoid blank UI
    cachedSpec = {
      openapi: '3.0.0',
      info: {
        title: process.env.SWAGGER_TITLE || 'Dashboard API',
        version: process.env.SWAGGER_VERSION || '1.0.0',
        description:
          process.env.SWAGGER_DESCRIPTION ||
          'REST API for Data Management Dashboard with MongoDB and Express',
      },
      paths: {},
      components: buildCommonComponents(),
    };
    return cachedSpec;
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getBaseOpenApiSpec,
};
