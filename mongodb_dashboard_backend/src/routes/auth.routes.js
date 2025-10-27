const express = require('express');
const { getTenantSaltConfig, getTenantConfig } = require('../config/auth');
const User = require('../models/user.model');
const Tenant = require('../models/tenant.model');
const { hashPasswordV2, verifyPassword, ensureTenantOrgSalt } = require('../utils/authHash');

const router = express.Router();
// Note: This router is mounted at /api/auth in app.js, so endpoints are effective under /api/auth.

/**
 * PUBLIC_INTERFACE
 * Simple configuration health check for auth settings (does not expose secrets)
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
      ? 'SECRET_SALT must be URL-safe base64 (no =) 22-24 chars, e.g., g5StFHvCyj0Hf9g8j87nGA'
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
 * PUBLIC_INTERFACE
 * @swagger
 * /api/auth/signup:
 *   post:
 *     summary: Signup
 *     description: >
 *       Create or update a user with a password hashed using the per-organization salt (v2).<br/>
 *       Generates missing tenant orgSalt automatically. Sets user.hashVersion = 2.<br/>
 *       This is a minimal demo endpoint; add email verification and stricter validations for production.
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
 *                 description: Tenant identifier (resolved via configured strategy)
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *             required: [organization_id, email, password]
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: Bad request or invalid tenant
 *       422:
 *         description: Validation Error
 *
 * Inline notes on hashing scheme and migration:
 * - v1 (legacy): static salt from environment (SECRET_SALT/AUTH_TENANT_SALT); verification-only.
 * - v2 (current): tenant.orgSalt (+ optional global pepper from env) concatenated with password, hashed using
 *                 argon2id when available, then bcrypt, then scrypt as a fallback. New accounts use v2.
 * - If tenant.orgSalt is missing (legacy tenants), it is auto-generated and persisted on-demand.
 */
router.post('/signup', async (req, res) => {
  const { organization_id, email, password } = req.body || {};
  const errors = [];

  const validateStringField = (value, fieldName) => {
    if (value === undefined || value === null) {
      errors.push({ loc: ['body', fieldName], msg: 'field required', type: 'value_error' });
    } else if (typeof value !== 'string') {
      errors.push({ loc: ['body', fieldName], msg: 'must be a string', type: 'value_error' });
    } else if (value.trim() === '') {
      errors.push({ loc: ['body', fieldName], msg: 'must not be empty', type: 'value_error' });
    }
  };
  validateStringField(organization_id, 'organization_id');
  validateStringField(email, 'email');
  validateStringField(password, 'password');

  if (errors.length > 0) return res.status(422).json({ detail: errors });

  const { resolveTenant, isTenantAllowed } = getTenantConfig();
  const tenantId = resolveTenant(req, organization_id);
  if (!tenantId) {
    return res.status(400).json({ success: false, message: 'Tenant could not be resolved from request.' });
  }
  if (!isTenantAllowed(tenantId)) {
    return res.status(400).json({ success: false, message: `Invalid or unknown tenant: ${tenantId}.` });
  }

  try {
    const tenant = await Tenant.findOne({ tenant_id: tenantId });
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant does not exist' });
    }
    await ensureTenantOrgSalt(tenant);

    const { hash, version } = await hashPasswordV2(password, tenant);
    const now = new Date();

    const doc = await User.findOneAndUpdate(
      { email },
      {
        $set: {
          email,
          password_hash: hash,
          hashVersion: version,
          updated_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true, new: true, lean: true }
    );

    return res.status(201).json({ success: true, user_id: String(doc._id), email: doc.email, tenant_id: tenantId });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[auth.signup] failed', e?.message || e);
    return res.status(400).json({ success: false, message: 'Signup failed' });
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login
 *     description: Authenticate a user by organization, email and password. Performs on-login migration from legacy hash to per-tenant orgSalt scheme.
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
 *       401:
 *         description: Invalid credentials
 *       422:
 *         description: Validation Error
 */
/*
PUBLIC_INTERFACE
Route: POST /auth/login
- Accepts JSON body only: { organization_id: string, email: string, password: string }
- Verifies credentials using user.password_hash and hashVersion when present.
- If v1 (legacy) verifies, rehashes with v2 immediately and updates the user doc (online migration).
- Backward compatible behavior: if user has no password_hash (legacy placeholder accounts), returns success to avoid breaking existing users.
*/
router.post('/login', async (req, res) => {
  const { organization_id, email, password } = req.body || {};
  const errors = [];

  const validateStringField = (value, fieldName) => {
    if (value === undefined || value === null) {
      errors.push({ loc: ['body', fieldName], msg: 'field required', type: 'value_error' });
    } else if (typeof value !== 'string') {
      errors.push({ loc: ['body', fieldName], msg: 'must be a string', type: 'value_error' });
    } else if (value.trim() === '') {
      errors.push({ loc: ['body', fieldName], msg: 'must not be empty', type: 'value_error' });
    }
  };

  validateStringField(organization_id, 'organization_id');
  validateStringField(email, 'email');
  validateStringField(password, 'password');

  if (errors.length > 0) {
    return res.status(422).json({ detail: errors });
  }

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
    });
  }

  try {
    const tenant = await Tenant.findOne({ tenant_id: tenantId });
    if (!tenant) {
      return res.status(400).json({ success: false, message: 'Tenant does not exist' });
    }
    await ensureTenantOrgSalt(tenant);

    const user = await User.findOne({ email }).lean();
    if (!user) {
      // Preserve previous "ok" behaviors minimally: do not disclose if email exists
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // If user has no password hash (legacy or analytics-only user), do not break existing flows
    if (!user.password_hash) {
      // eslint-disable-next-line no-console
      console.info('[auth.login] user has no password_hash; returning success for backward compatibility');
      return res.status(200).json({ success: true, tenant_id: tenantId, token: 'ok' });
    }

    const { ok, needsMigration } = await verifyPassword({ password, user, tenant });
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // On-login migration: if legacy verified, rehash with v2 and update
    if (needsMigration) {
      try {
        const { hash, version } = await hashPasswordV2(password, tenant);
        await User.updateOne({ _id: user._id }, { $set: { password_hash: hash, hashVersion: version, updated_at: new Date() } });
        // eslint-disable-next-line no-console
        console.info('[auth.login] migrated user hash to v2', { user_id: String(user._id) });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[auth.login] migration failed (continuing auth)', { message: e?.message });
      }
    }

    // Placeholder token; in production sign a JWT using AUTH_JWT_SECRET
    return res.status(200).json({ success: true, tenant_id: tenantId, token: 'ok' });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[auth.login] failed', e?.message || e);
    return res.status(400).json({ success: false, message: 'Login failed' });
  }
});

/**
 * PUBLIC_INTERFACE
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password
 *     description: >
 *       Resets a user's password using the v2 scheme (tenant orgSalt + optional global pepper).<br/>
 *       Auto-generates tenant orgSalt if missing (legacy tenant). DEMO ONLY – add token validation and throttling for production.
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
 *     responses:
 *       200:
 *         description: Password reset ok
 *       404:
 *         description: User not found
 *       400:
 *         description: Bad request or invalid tenant
 *       422:
 *         description: Validation error
 *
 * SECURITY & MIGRATION NOTES:
 * - This endpoint rehashes using v2 regardless of prior version; user.hashVersion is set to 2 on success.
 * - If tenant.orgSalt is missing, it is generated and persisted before hashing.
 */
router.post('/reset-password', async (req, res) => {
  const { organization_id, email, password } = req.body || {};
  const errors = [];
  const reqFields = ['organization_id', 'email', 'password'];
  for (const f of reqFields) {
    if (!req.body || typeof req.body[f] !== 'string' || req.body[f].trim() === '') {
      errors.push({ loc: ['body', f], msg: 'field required', type: 'value_error' });
    }
  }
  if (errors.length > 0) return res.status(422).json({ detail: errors });

  const { resolveTenant, isTenantAllowed } = getTenantConfig();
  const tenantId = resolveTenant(req, organization_id);
  if (!tenantId) return res.status(400).json({ success: false, message: 'Tenant could not be resolved from request.' });
  if (!isTenantAllowed(tenantId)) return res.status(400).json({ success: false, message: `Invalid or unknown tenant: ${tenantId}.` });

  try {
    const tenant = await Tenant.findOne({ tenant_id: tenantId });
    if (!tenant) return res.status(400).json({ success: false, message: 'Tenant does not exist' });
    await ensureTenantOrgSalt(tenant);

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { hash, version } = await hashPasswordV2(password, tenant);
    user.password_hash = hash;
    user.hashVersion = version;
    user.updated_at = new Date();
    await user.save();

    return res.status(200).json({ success: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[auth.reset-password] failed', e?.message || e);
    return res.status(400).json({ success: false, message: 'Reset failed' });
  }
});

module.exports = router;
