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
 *    - Ensure common components (xOrganizationId header) are available
 * 2) Fallback to JSDoc extraction from ./src/routes/*.js
 *    - Provide shared component schemas so responses render correctly
 *
 * This module exports a function getBaseOpenApiSpec() to retrieve the base spec.
 */

/** Build the reusable components injected into any loaded spec */
function buildCommonComponents() {
  return {
    parameters: {
      xOrganizationId: {
        name: 'x-organization-id',
        in: 'header',
        required: true,
        schema: { type: 'string' },
        description:
          'Required tenant identifier for tenant-scoped endpoints. Header takes precedence over query aliases (?tenant_id or ?organization_id). 400 is returned when tenant is missing.',
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
    },
    apis: ['./src/routes/*.js'],
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
  if (!doc || typeof doc !== 'object') {return null;}

  // Remove invalid path keys
  let hasAnyValidPath = false;
  if (doc.paths && typeof doc.paths === 'object') {
    const validPaths = {};
    Object.entries(doc.paths).forEach(([key, val]) => {
      if (typeof key === 'string' && key.startsWith('/')) {
        validPaths[key] = val;
        hasAnyValidPath = true;
      }
    });
    doc.paths = validPaths;
  } else {
    doc.paths = {};
  }

  if (!hasAnyValidPath) {return null;}

  if (!doc.openapi) {doc.openapi = '3.0.0';}
  if (!doc.info) {
    doc.info = {
      title: process.env.SWAGGER_TITLE || 'Dashboard API',
      version: process.env.SWAGGER_VERSION || '1.0.0',
      description:
        process.env.SWAGGER_DESCRIPTION ||
        'REST API for Data Management Dashboard with MongoDB and Express',
    };
  } else if (typeof doc.info.description === 'string') {
    // Keep description readable without unnecessary escape sequences
    doc.info.description = doc.info.description.replace(/\s+/g, ' ').trim();
  }

  // Inject common components if missing
  const commons = buildCommonComponents();
  doc.components = doc.components || {};
  doc.components.parameters = {
    ...(doc.components.parameters || {}),
    xOrganizationId:
      doc.components.parameters?.xOrganizationId || commons.parameters.xOrganizationId,
  };
  doc.components.schemas = {
    ...(doc.components.schemas || {}),
    GenericDocument:
      doc.components.schemas?.GenericDocument || commons.schemas.GenericDocument,
    ListEnvelope:
      doc.components.schemas?.ListEnvelope || commons.schemas.ListEnvelope,
  };

  try {
    JSON.stringify(doc);
  } catch {
    return null;
  }

  return doc;
}

// Cache result
let cachedSpec = null;

/**
 * PUBLIC_INTERFACE
 * getBaseOpenApiSpec
 */
function getBaseOpenApiSpec() {
  if (cachedSpec) {return cachedSpec;}

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
     
    console.warn('[swagger] Could not load interfaces/openapi.json, falling back to JSDoc.', err?.message);
  }

  try {
    cachedSpec = buildJsDocSpec();
    return cachedSpec;
  } catch (err) {
     
    console.error('[swagger] Failed to build JSDoc spec:', err);
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

const swaggerSpecApi = { getBaseOpenApiSpec };

module.exports = {
  ...swaggerSpecApi,
  default: swaggerSpecApi,
};
