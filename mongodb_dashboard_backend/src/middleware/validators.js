const { isValidUrl } = require('../utils/validators');

function validateAppDeployment(req, res, next) {
  const { app_url, custom_domain } = req.body || {};
  if (app_url && !isValidUrl(app_url)) {
    return res.status(400).json({ success: false, message: 'Invalid app_url' });
  }
  if (custom_domain && /[^a-zA-Z0-9.-]/.test(custom_domain)) {
    return res.status(400).json({ success: false, message: 'Invalid custom_domain' });
  }
  // Informational note: tenant scoping is enforced server-side
  // Accepts tenant from JWT/header x-organization-id or query ?tenant_id=/legacy ?organization_id=
  // Any payload.tenant_id will be overridden.
  return next();
}

module.exports = { validateAppDeployment };
