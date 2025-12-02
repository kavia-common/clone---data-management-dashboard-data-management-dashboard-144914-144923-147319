const { isValidUrl } = require('../utils/validators');

/**
 * PUBLIC_INTERFACE
 * validateAppDeployment
 * Validates app deployment payload minimally:
 * - app_url must be a valid http(s) URL if provided
 * - custom_domain may only include alphanumerics, dot and hyphen
 */
function validateAppDeployment(req, res, next) {
  const { app_url, custom_domain } = req.body || {};
  if (app_url && !isValidUrl(app_url)) {
    return res.status(400).json({ success: false, message: 'Invalid app_url' });
  }
  // Allow alphanumerics, dot and hyphen; '-' does not need to be escaped inside character class
  if (custom_domain && /[^a-zA-Z0-9.-]/.test(custom_domain)) {
    return res.status(400).json({ success: false, message: 'Invalid custom_domain' });
  }
  // Informational note: tenant scoping is enforced server-side
  // Accepts tenant from JWT/header x-organization-id or query ?tenant_id=/legacy ?organization_id=
  // Any payload.tenant_id will be overridden.
  return next();
}

module.exports = { validateAppDeployment };
