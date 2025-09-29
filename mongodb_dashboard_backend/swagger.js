const swaggerJSDoc = require('swagger-jsdoc');

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
    // Note: No securitySchemes or global security as endpoints are public
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);
module.exports = swaggerSpec;
