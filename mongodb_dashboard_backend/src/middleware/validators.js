'use strict';

const { isValidUrl } = require('../utils/validators');

/**
 * PUBLIC_INTERFACE
 * validateAppDeployment
 * Validates payload for app deployments. Organization/tenant is handled by global middleware and server-side stamping.
 */
function validateAppDeployment(req, res, next) {
  const { app_url, custom_domain } = req.body || {};
  if (app_url && !isValidUrl(app_url)) {
    return res.status(400).json({ success: false, message: 'Invalid app_url' });
  }
  if (custom_domain && /[^a-zA-Z0-9.-]/.test(custom_domain)) {
    return res.status(400).json({ success: false, message: 'Invalid custom_domain' });
  }
  // Tenant scoping: handled by middleware; do not require org here.
  return next();
}

module.exports = { validateAppDeployment };
