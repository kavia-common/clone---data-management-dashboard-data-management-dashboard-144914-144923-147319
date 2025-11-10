const fs = require('fs');
const path = require('path');
const swaggerJSDoc = require('swagger-jsdoc');

/**
 * PUBLIC_INTERFACE
 * Builds the base Swagger/OpenAPI specification for the Express app.
 *
 * Strategy:
 * 1) Try to load a prebuilt OpenAPI spec from interfaces/openapi.json (preferred)
 *    - Sanitize invalid path keys (must start with '/')
 *    - Ensure required fields exist (openapi, info)
 * 2) Fallback to JSDoc extraction from ./src/routes/*.js
 *    - Provide shared component schemas so responses render correctly
 *
 * This module exports a function getBaseOpenApiSpec() to retrieve the base spec.
 */

/**
 * Create a Swagger spec from JSDoc annotations as a fallback.
 */
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
      components: {
        parameters: {
          xOrganizationId: {
            name: 'x-organization-id',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description:
              'Required tenant identifier for all tenant-scoped endpoints. You can also use query ?tenant_id or ?organization_id, but the header takes precedence.',
          },
        },
        schemas: {
          // A flexible document to represent MongoDB documents without strict typing
          GenericDocument: {
            type: 'object',
            description: 'A generic MongoDB document with flexible fields',
            additionalProperties: true,
            properties: {
              _id: { type: 'string', description: 'MongoDB ObjectId as string' },
            },
          },
          // Envelope for paginated list responses
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
      },
      // Endpoints are public; no global security
    },
    apis: ['./src/routes/*.js'],
  };
  return swaggerJSDoc(options);
}

/**
 * Sanitize an OpenAPI document object:
 * - Ensure "paths" contains only keys that start with '/'
 * - Ensure "openapi" and "info" are present
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
      // Drop keys that are not valid path templates
    });
    doc.paths = validPaths;
  } else {
    doc.paths = {};
  }

  // If there are no valid paths after sanitization, treat as invalid to trigger JSDoc fallback
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

  // Minimal validation by serializing to JSON
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
    };
    return cachedSpec;
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getBaseOpenApiSpec,
};
