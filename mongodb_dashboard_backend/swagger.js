'use strict';

const fs = require('fs');
const path = require('path');
const swaggerJSDoc = require('swagger-jsdoc');

/**
 * PUBLIC_INTERFACE
 * Builds the base Swagger/OpenAPI specification for the Express app.
 *
 * Enhancements:
 * - Adds reusable x-organization-id header + tenant_id and organization_id query parameters globally.
 * - Adds bearerAuth security scheme for JWT Authorization header and applies it to protected endpoints.
 * - Cleans invalid paths and ensures valid structure.
 * - Falls back to JSDoc-generated spec when openapi.json is unavailable.
 */

/** Build reusable components for tenant/organization scope */
function buildCommonComponents() {
  return {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Provide a Bearer token obtained from POST /api/auth/login',
      },
    },
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
          'Preferred tenant identifier for tenant-scoped endpoints, supplied via request header. When present, this header determines the active organization scope for the request. If not provided, the server may fall back to JWT/session context or query parameters tenant_id/organization_id.',
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
          'Optional tenant identifier synonym for organization_id, accepted for filtering/scoping when header x-organization-id is not provided.',
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

/** Build Swagger spec from JSDoc comments */
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

/** Clean and normalize a loaded OpenAPI document */
function sanitizeOpenApiDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;

  // Keep only valid path keys
  if (doc.paths && typeof doc.paths === 'object') {
    const validPaths = {};
    for (const [key, val] of Object.entries(doc.paths)) {
      if (key.startsWith('/')) validPaths[key] = val;
    }
    doc.paths = validPaths;
  } else {
    doc.paths = {};
  }

  doc.openapi ||= '3.0.0';
  doc.info ||= {
    title: process.env.SWAGGER_TITLE || 'Dashboard API',
    version: process.env.SWAGGER_VERSION || '1.0.0',
    description:
      process.env.SWAGGER_DESCRIPTION ||
      'REST API for Data Management Dashboard with MongoDB and Express',
  };

  // Merge common components
  const commons = buildCommonComponents();
  doc.components = doc.components || {};
  doc.components.securitySchemes = { ...commons.securitySchemes, ...doc.components.securitySchemes };
  doc.components.parameters = { ...commons.parameters, ...doc.components.parameters };
  doc.components.schemas = { ...commons.schemas, ...doc.components.schemas };

  // ✅ Inject global parameters and security (applies to all non-auth endpoints)
  for (const pathKey of Object.keys(doc.paths)) {
    const pathItem = doc.paths[pathKey];
    for (const methodKey of Object.keys(pathItem || {})) {
      const op = pathItem[methodKey];
      if (['get', 'post', 'put', 'patch', 'delete'].includes(methodKey)) {
        op.parameters = op.parameters || [];
        const refs = [
          { $ref: '#/components/parameters/xOrganizationId' },
          { $ref: '#/components/parameters/organizationIdQuery' },
          { $ref: '#/components/parameters/tenantIdQuery' },
        ];
        // Prevent duplicates
        refs.forEach((ref) => {
          if (!op.parameters.some((p) => p.$ref === ref.$ref)) {
            op.parameters.push(ref);
          }
        });

        // Apply bearerAuth to protected endpoints; skip obvious public ones like /api/auth/*
        // Simple heuristic: if path includes '/api/auth/' and method is post/get for login/signup, do not secure.
        const isAuthPath = /^\/api\/auth(\/|$)/.test(pathKey);
        if (!isAuthPath) {
          op.security = op.security || [{ bearerAuth: [] }];
          if (!op.security.some((s) => Object.prototype.hasOwnProperty.call(s, 'bearerAuth'))) {
            op.security.push({ bearerAuth: [] });
          }
        }
      }
    }
  }

  try {
    JSON.stringify(doc);
    return doc;
  } catch {
    return null;
  }
}

let cachedSpec = null;

/** PUBLIC_INTERFACE - getBaseOpenApiSpec() */
function getBaseOpenApiSpec() {
  if (cachedSpec) return cachedSpec;

  try {
    // Try to load interfaces/openapi.json
    let filePath = path.resolve(__dirname, 'interfaces', 'openapi.json');
    if (!fs.existsSync(filePath)) {
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
    console.warn('[swagger] Could not load openapi.json, falling back to JSDoc:', err.message);
  }

  try {
    cachedSpec = sanitizeOpenApiDoc(buildJsDocSpec());
    return cachedSpec;
  } catch (err) {
    console.error('[swagger] Failed to build spec:', err.message);
    cachedSpec = {
      openapi: '3.0.0',
      info: {
        title: 'Dashboard API',
        version: '1.0.0',
      },
      paths: {},
      components: buildCommonComponents(),
    };
    return cachedSpec;
  }
}

module.exports = { getBaseOpenApiSpec };
