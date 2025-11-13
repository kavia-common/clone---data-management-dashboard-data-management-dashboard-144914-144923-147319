'use strict';

const fs = require('fs');
const path = require('path');
const swaggerJSDoc = require('swagger-jsdoc');

/**
 * PUBLIC_INTERFACE
 * Builds and returns the base Swagger/OpenAPI specification for the Express app.
 *
 * Strategy:
 * 1) Prefer prebuilt OpenAPI spec from interfaces/openapi.json
 *    - Sanitize invalid path keys (must start with '/')
 *    - Ensure required fields exist (openapi, info)
 *    - Ensure common components are present
 * 2) Fallback to JSDoc extraction from ./src/routes/*.js
 *
 * IMPORTANT: This file MUST NOT add any authentication endpoints or tags.
 * We do not merge any fragments that include /auth/*, /api/auth/*, /login, /logout, /token, /refresh, or /session.
 * Only business APIs are documented here. bearerAuth security remains available.
 */

// PUBLIC_INTERFACE
function buildCommonComponents() {
  /** This function defines shared components to inject when missing. */
  return {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Provide a valid JWT as a Bearer token. When present, tenant is resolved from the token and overrides x-organization-id and query aliases.',
      },
    },
    parameters: {
      xOrganizationId: {
        name: 'x-organization-id',
        in: 'header',
        required: true,
        schema: { type: 'string', example: 'org_demo' },
        description:
          'Tenant (organization) identifier header for tenant-scoped endpoints when Authorization is not provided. Alternatively pass as query parameter ?organization_id (or ?tenant_id). Header takes precedence over query aliases. When Authorization (Bearer JWT) is present, the tenant is taken from the token and this header is not required.',
      },
      OrganizationIdQuery: {
        in: 'query',
        name: 'organization_id',
        required: false,
        schema: { type: 'string' },
        description:
          'Optional tenant (organization) identifier as a query parameter. Use header x-organization-id instead when possible.',
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
          'REST API for Data Management Dashboard with MongoDB and Express.\n\nAuthentication and Tenant Scoping\n- Authentication endpoints (e.g., /auth/*, /api/auth/*, /login, /logout, /token, /refresh, /session) are managed externally and are not documented here. Use the Authorize button to provide a Bearer token (JWT).\n- Click the "Authorize" button in Swagger UI to enter your Bearer token (JWT) for Authorization.\n- For tenant-scoped endpoints, provide the tenant in the x-organization-id header; with a valid JWT, tenant is taken from the token and overrides header/query.\n- Without JWT (for demo/testing), you may use the x-organization-id header or organization_id/tenant_id query parameter to set scope. The header takes precedence over query.\n',
      },
      components: buildCommonComponents(),
      security: [{ bearerAuth: [] }],
    },
    apis: ['./src/routes/*.js'],
  };
  return swaggerJSDoc(options);
}

/**
 * Sanitize an OpenAPI document object:
 * - Ensure "paths" contains only keys that start with '/'
 * - Ensure no auth endpoints or auth tags exist
 * - Ensure "openapi" and "info" are present
 * - Ensure reusable parameters/schemas and bearerAuth are present
 * - Ensure global security [{ bearerAuth: [] }]
 */
function sanitizeOpenApiDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;

  // Remove invalid path keys and filter out auth endpoints
  const invalidAuthPath = (p) =>
    p.startsWith('/auth/') ||
    p.startsWith('/api/auth/') ||
    p === '/login' ||
    p === '/logout' ||
    p === '/token' ||
    p === '/refresh' ||
    p === '/session';
  let hasAnyValidPath = false;
  const validPaths = {};
  if (doc.paths && typeof doc.paths === 'object') {
    Object.entries(doc.paths).forEach(([key, val]) => {
      if (
        typeof key === 'string' &&
        key.startsWith('/') &&
        !invalidAuthPath(key) &&
        val &&
        typeof val === 'object'
      ) {
        validPaths[key] = val;
        hasAnyValidPath = true;
      }
    });
  }
  doc.paths = validPaths;

  // Ensure info exists and update description note
  if (!doc.openapi) doc.openapi = '3.0.0';
  doc.info = doc.info || {};
  doc.info.title = doc.info.title || 'Dashboard API';
  doc.info.version = doc.info.version || '1.0.0';
  const note =
    'Authentication endpoints (e.g., /auth/*, /api/auth/*, /login, /logout, /token, /refresh, /session) are managed externally and are not documented here. Use the Authorize button to provide a Bearer token (JWT).';
  const baseDesc =
    typeof doc.info.description === 'string' && doc.info.description.length
      ? doc.info.description
      : 'REST API for Data Management Dashboard with MongoDB and Express.';
  if (!baseDesc.includes('Authentication endpoints (e.g., /auth/*')) {
    doc.info.description = `${baseDesc}\n\nAuthentication and Tenant Scoping\n- ${note}\n- Click the "Authorize" button in Swagger UI to enter your Bearer token (JWT) for Authorization.\n- For tenant-scoped endpoints, provide the tenant in the x-organization-id header field. With a valid JWT, tenant is taken from the token and overrides header/query.\n- Without JWT (for demo/testing), you may use the x-organization-id header or organization_id/tenant_id query parameter to set scope. The header takes precedence over query.\n`;
  } else {
    doc.info.description = baseDesc;
  }

  // Remove 'Auth' tag if present
  if (Array.isArray(doc.tags)) {
    doc.tags = doc.tags.filter((t) => t && t.name !== 'Auth');
  }

  // Ensure components and bearerAuth exist
  const commons = buildCommonComponents();
  doc.components = doc.components || {};
  doc.components.securitySchemes = {
    ...(doc.components.securitySchemes || {}),
    bearerAuth: doc.components.securitySchemes?.bearerAuth || commons.securitySchemes.bearerAuth,
  };
  doc.components.parameters = {
    ...(doc.components.parameters || {}),
    XOrganizationId:
      doc.components.parameters?.XOrganizationId || commons.parameters.xOrganizationId,
    OrganizationIdQuery:
      doc.components.parameters?.OrganizationIdQuery || commons.parameters.OrganizationIdQuery,
  };
  doc.components.schemas = {
    ...(doc.components.schemas || {}),
    GenericDocument:
      doc.components.schemas?.GenericDocument || commons.schemas.GenericDocument,
    ListEnvelope: doc.components.schemas?.ListEnvelope || commons.schemas.ListEnvelope,
  };

  // Ensure global security is set to bearerAuth
  if (!Array.isArray(doc.security) || doc.security.length === 0) {
    doc.security = [{ bearerAuth: [] }];
  }

  try {
    JSON.stringify(doc);
  } catch {
    return null;
  }

  return doc;
}

// Cache result
let cachedSpec = null;

// PUBLIC_INTERFACE
function getBaseOpenApiSpec() {
  if (cachedSpec) return cachedSpec;

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
    console.warn(
      '[swagger] Could not load interfaces/openapi.json, falling back to JSDoc.',
      err?.message
    );
  }

  try {
    cachedSpec = sanitizeOpenApiDoc(buildJsDocSpec()) || buildJsDocSpec();
    return cachedSpec;
  } catch (err) {
    console.error('[swagger] Failed to build JSDoc spec:', err);
    cachedSpec = {
      openapi: '3.0.0',
      info: {
        title: process.env.SWAGGER_TITLE || 'Dashboard API',
        version: process.env.SWAGGER_VERSION || '1.0.0',
        description:
          'REST API for Data Management Dashboard with MongoDB and Express.\n\nAuthentication and Tenant Scoping\n- Authentication endpoints (e.g., /auth/*, /api/auth/*, /login, /logout, /token, /refresh, /session) are managed externally and are not documented here. Use the Authorize button to provide a Bearer token (JWT).',
      },
      paths: {},
      security: [{ bearerAuth: [] }],
      components: buildCommonComponents(),
    };
    return cachedSpec;
  }
}

module.exports = { getBaseOpenApiSpec };
