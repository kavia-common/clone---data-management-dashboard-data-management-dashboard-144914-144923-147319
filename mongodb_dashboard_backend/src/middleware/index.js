'use strict';
/**
 * PUBLIC_INTERFACE
 * Middleware registry: export common middlewares for centralized imports.
 */
const middleware = {
  verifyAuth: require('./verifyAuth').verifyAuth,
  requireTenant: require('./requireTenant').requireTenant,
  ...require('./authTenant'),
  extractOrganization: require('./extractOrganization').extractOrganization,
};

module.exports = middleware;
