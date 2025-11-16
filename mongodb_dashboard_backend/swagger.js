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
  if (!doc || typeof doc !== 'object') return null;

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

  if (!hasAnyValidPath) return null;

  if (!doc.openapi) doc.openapi = '3.0.0';
  if (!doc.info) {
    doc.info = {
      title: process.env.SWAGGER_TITLE || 'Dashboard API',
      version: process.env.SWAGGER_VERSION || '1.0.0',
      description:
        process.env.SWAGGER_DESCRIPTION ||
        'REST API for Data Management Dashboard with MongoDB and Express',
    };
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
  if (cachedSpec) return cachedSpec;

  try {
    const filePath = path.resolve(__dirname, 'interfaces', 'openapi.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeOpenApiDoc(parsed);
    if (sanitized) {
      // Inject sessions breaks endpoint if missing
      sanitized.paths = sanitized.paths || {};
      if (!sanitized.paths['/api/sessions/{sessionId}/breaks']) {
        sanitized.paths['/api/sessions/{sessionId}/breaks'] = {
          get: {
            summary: 'Get session-break details by sessionId',
            description:
              'Returns a single session tracking document and its session_breakdown fields for the specified sessionId. ' +
              'Tenant scoping: When Authorization (Bearer JWT) is present, the tenant from the JWT is enforced and overrides any header/query values. ' +
              'Without JWT (demo/testing), x-organization-id header or query aliases (?tenant_id or ?organization_id) may be used to set scope.',
            tags: ['SessionTracking'],
            security: [{ bearerAuth: [] }],
            parameters: [
              { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' }, description: 'Session identifier to look up' },
              { in: 'header', name: 'x-organization-id', required: false, schema: { type: 'string' }, description: 'Tenant (organization) ID. Required when JWT is not provided; ignored if JWT is present with tenant.' },
              { in: 'query', name: 'organization_id', required: false, schema: { type: 'string' }, description: 'Alias for tenant filter. Ignored when JWT is present. Header takes precedence over query.' },
              { in: 'query', name: 'tenant_id', required: false, schema: { type: 'string' }, description: 'Alias for tenant filter. Ignored when JWT is present. Header takes precedence over query.' },
            ],
            responses: {
              200: { description: 'Session details with breakdown when found', content: { 'application/json': { schema: { $ref: '#/components/schemas/GenericDocument' } } } },
              400: { description: 'Invalid input' },
              404: { description: 'Session not found for the active tenant' },
            },
          },
        };
      }
      cachedSpec = sanitized;
      return cachedSpec;
    }
  } catch (err) {
    console.warn('[swagger] Could not load interfaces/openapi.json, falling back to JSDoc.', err?.message);
  }

  try {
    cachedSpec = buildJsDocSpec();
    // Inject sessions breaks endpoint if missing
    if (cachedSpec && typeof cachedSpec === 'object') {
      cachedSpec.paths = cachedSpec.paths || {};
      if (!cachedSpec.paths['/api/sessions/{sessionId}/breaks']) {
        cachedSpec.paths['/api/sessions/{sessionId}/breaks'] = {
          get: {
            summary: 'Get session-break details by sessionId',
            description:
              'Returns a single session tracking document and its session_breakdown fields for the specified sessionId. ' +
              'Tenant scoping: When Authorization (Bearer JWT) is present, the tenant from the JWT is enforced and overrides any header/query values. ' +
              'Without JWT (demo/testing), x-organization-id header or query aliases (?tenant_id or ?organization_id) may be used to set scope.',
            tags: ['SessionTracking'],
            security: [{ bearerAuth: [] }],
            parameters: [
              { in: 'path', name: 'sessionId', required: true, schema: { type: 'string' }, description: 'Session identifier to look up' },
              { in: 'header', name: 'x-organization-id', required: false, schema: { type: 'string' }, description: 'Tenant (organization) ID. Required when JWT is not provided; ignored if JWT is present with tenant.' },
              { in: 'query', name: 'organization_id', required: false, schema: { type: 'string' }, description: 'Alias for tenant filter. Ignored when JWT is present. Header takes precedence over query.' },
              { in: 'query', name: 'tenant_id', required: false, schema: { type: 'string' }, description: 'Alias for tenant filter. Ignored when JWT is present. Header takes precedence over query.' },
            ],
            responses: {
              200: { description: 'Session details with breakdown when found', content: { 'application/json': { schema: { $ref: '#/components/schemas/GenericDocument' } } } },
              400: { description: 'Invalid input' },
              404: { description: 'Session not found for the active tenant' },
            },
          },
        };
      }
    }
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

module.exports = { getBaseOpenApiSpec };
