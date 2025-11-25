'use strict';
/**
 * PUBLIC_INTERFACE
 * Middleware registry: export common middlewares for centralized imports.
 *
 * Normalize to named constant to satisfy import/no-anonymous-default-export.
 */
const middleware = {
  verifyAuth: require('./verifyAuth').verifyAuth,
  requireTenant: require('./requireTenant').requireTenant,
  ...require('./authTenant'),
  extractOrganization: require('./extractOrganization').extractOrganization,
};

module.exports = {
  middleware,
  default: middleware,
};
