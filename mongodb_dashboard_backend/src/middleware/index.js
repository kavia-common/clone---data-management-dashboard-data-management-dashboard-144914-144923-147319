'use strict';
/**
 * PUBLIC_INTERFACE
 * Middleware registry: export common middlewares for centralized imports if desired.
 */
module.exports = {
  // Legacy/Existing
  verifyAuth: require('./verifyAuth').verifyAuth,
  requireTenant: require('./requireTenant').requireTenant,

  // New tenant JWT middleware and utilities
  ...require('./authTenant'),

  // Organization scoping
  extractOrganization: require('./extractOrganization').extractOrganization,
};