'use strict';

const { verifyAuth, requireTenant, tenantFilter } = require('./jwtAuth');
const simpleVerifyAuth = require('./verifyAuth');

module.exports = {
  verifyAuth,
  requireTenant,
  tenantFilter,
  simpleVerifyAuth, // deprecated fallback
};
