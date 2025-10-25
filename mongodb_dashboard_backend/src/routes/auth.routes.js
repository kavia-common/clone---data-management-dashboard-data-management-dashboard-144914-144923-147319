const express = require('express');
const { getTenantSaltConfig, getTenantConfig } = require('../config/auth');

const router = express.Router();
// Note: This router is mounted at /api/auth in app.js, so POST /api/auth/login is the effective path.

// PUBLIC_INTERFACE
// Simple configuration health check for auth settings (does not expose secrets)
/**
 * @swagger
 * /api/auth/health:
 *   get:
 *     summary: Auth configuration health
 *     description: Returns configuration status for authentication related environment variables (no secrets exposed).
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Status flags for auth configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tenantSaltConfigured:
 *                   type: boolean
 *                   description: Whether tenant salt is set and not placeholder/weak
 *                 tenantSaltWarning:
 *                   type: string
 *                   nullable: true
 *                   description: Optional warning message if salt is weak/placeholder
 */
router.get('/health', (req, res) => {
  const { isMissing, isPlaceholder, looksValid, salt } = getTenantSaltConfig();
  const tenantSaltConfigured = !(isMissing || isPlaceholder) && looksValid;
  const tenantSaltWarning = isMissing
    ? 'SECRET_SALT is missing'
    : !looksValid
      ? 'SECRET_SALT must be URL-safe base64 (no =) 22-24 chars'
      : isPlaceholder
        ? 'SECRET_SALT appears to be a placeholder/weak value'
        : null;

  return res.status(200).json({
    tenantSaltConfigured,
    tenantSaltWarning,
    // do not expose salt; include safe metadata only
    length: typeof salt === 'string' ? salt.length : 0,
  });
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login
 *     description: Authenticate a user by organization, email and password. Returns placeholder values in this stub implementation.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               organization_id:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *             required: [organization_id, email, password]
 *           example:
 *             organization_id: org_123
 *             email: user@example.com
 *             password: secret
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *             example: "string"
 *       404:
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *             example: "string"
 *       422:
 *         description: Validation Error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 detail:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       loc:
 *                         type: array
 *                         items:
 *                           oneOf:
 *                             - type: string
 *                             - type: number
 *                       msg:
 *                         type: string
 *                       type:
 *                         type: string
 *                     required: [loc, msg, type]
 *               required: [detail]
 *             example:
 *               detail:
 *                 - loc: ["body", "organization_id"]
 *                   msg: "field required"
 *                   type: "value_error"
 */

/*
PUBLIC_INTERFACE
Route: POST /auth/login
Minimal placeholder login endpoint with validation.
- Accepts JSON body only: { organization_id: string, email: string, password: string }
- Returns:
  - 422 for validation errors with { detail: [ { loc: ['body', '<field>'], msg: '<message>', type: 'value_error' } ] }
  - 404 if "user not found" simulated condition triggers
  - 200 with a JSON string (placeholder token or 'ok')
*/
router.post('/login', (req, res) => {
  // Ensure content-type JSON body parsing has been applied upstream (app.js uses express.json()).
  const { organization_id, email, password } = req.body || {};

  const errors = [];

  // Validate presence and type of required fields
  const validateStringField = (value, fieldName) => {
    if (value === undefined || value === null) {
      errors.push({
        loc: ['body', fieldName],
        msg: 'field required',
        type: 'value_error',
      });
    } else if (typeof value !== 'string') {
      errors.push({
        loc: ['body', fieldName],
        msg: 'must be a string',
        type: 'value_error',
      });
    } else if (value.trim() === '') {
      errors.push({
        loc: ['body', fieldName],
        msg: 'must not be empty',
        type: 'value_error',
      });
    }
  };

  validateStringField(organization_id, 'organization_id');
  validateStringField(email, 'email');
  validateStringField(password, 'password');

  if (errors.length > 0) {
    return res.status(422).json({ detail: errors });
  }

  // Configuration validation: require a properly configured tenant salt
  const { isMissing, isPlaceholder, looksValid } = getTenantSaltConfig();
  if (isMissing || isPlaceholder || !looksValid) {
    const msg = isMissing
      ? 'Authentication salt missing. Set SECRET_SALT in environment.'
      : !looksValid
        ? 'Authentication salt format invalid. SECRET_SALT must be URL-safe base64 (no =) ~22-24 chars.'
        : 'Authentication salt appears to be a placeholder/weak value. Provide a stronger SECRET_SALT.';
    // Return 400 so clients can self-heal/configure rather than seeing a 500.
    return res.status(400).json({
      success: false,
      message: msg,
      docs:
        'Add SECRET_SALT to your environment. Recommended: node -e "console.log(require(\'crypto\').randomBytes(16).toString(\'base64url\'))". See README_BACKEND.md and .env.example.',
    });
  }

  // Resolve tenant using env-driven strategy and validate against mapping/allowlist
  const { resolveTenant, isTenantAllowed, strategy, defaultTenant } = getTenantConfig();
  const tenantId = resolveTenant(req, organization_id);

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant could not be resolved from request.',
      details: { strategy, defaultTenant },
    });
  }

  if (!isTenantAllowed(tenantId)) {
    return res.status(400).json({
      success: false,
      message: `Invalid or unknown tenant: ${tenantId}.`,
      docs:
        'Configure AUTH_TENANT_MAPPING (JSON) or AUTH_EXPECTED_TENANTS (CSV) to include this tenant. See README_BACKEND.md and .env.example.',
    });
  }

  // Simulate user not found condition: if tenant looks malformed OR email invalid
  if (!String(email).includes('@')) {
    // Auth failed
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  // Placeholder success (no real auth yet). In a real impl, you'd hash/verify password and mint a JWT using AUTH_JWT_SECRET.
  return res.status(200).json({ success: true, tenant_id: tenantId, token: 'ok' });
});

module.exports = router;
