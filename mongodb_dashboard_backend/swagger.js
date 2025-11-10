'use strict';

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
        required: false,
        schema: {
          type: 'string',
          example: 'org_123',
        },
        description:
          'Preferred tenant identifier for tenant-scoped endpoints, supplied via request header. When present, this header determines the active organization scope for the request. If not provided, the server may fall back to JWT/session context or query parameters tenant_id/organization_id when supported.',
      },
      organizationIdQuery: {
        name: 'organization_id',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          example: 'org_123',
        },
        description:
          'Optional organization identifier used to filter and scope results. Preferred via header x-organization-id; this query parameter is accepted for filtering when header is absent. Not part of request bodies.',
      },
      tenantIdQuery: {
        name: 'tenant_id',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          example: 'org_123',
        },
        description:
          'Optional tenant identifier synonym for organization_id, accepted for filtering/scoping when header x-organization-id is not provided. Not part of request bodies.',
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
  const commons = buildCommonComponents();
  doc.components.parameters.xOrganizationId =
    doc.components.parameters.xOrganizationId || commons.parameters.xOrganizationId;
  doc.components.schemas.GenericDocument =
    doc.components.schemas.GenericDocument || commons.schemas.GenericDocument;
  doc.components.schemas.ListEnvelope =
    doc.components.schemas.ListEnvelope || commons.schemas.ListEnvelope;

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
    // Resolve interfaces/openapi.json relative to repo root or this file dir to be robust
    let filePath = path.resolve(__dirname, 'interfaces', 'openapi.json');
    if (!fs.existsSync(filePath)) {
      // Try project root -> container root -> interfaces
      const alt = path.resolve(process.cwd(), 'interfaces', 'openapi.json');
      if (fs.existsSync(alt)) filePath = alt;
    }
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