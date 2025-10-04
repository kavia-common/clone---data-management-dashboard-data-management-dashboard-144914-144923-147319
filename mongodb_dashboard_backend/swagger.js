const swaggerJSDoc = require('swagger-jsdoc');

/**
 * PUBLIC_INTERFACE
 * Builds the Swagger/OpenAPI specification for the Express app.
 * - Pulls JSDoc annotations from route files under ./src/routes/*.js
 * - Provides shared component schemas to ensure response bodies render with actual shapes in Swagger UI.
 */
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

const swaggerSpec = swaggerJSDoc(options);
module.exports = swaggerSpec;
