'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { getEncryptedOrganizationId } = require('../utils/organizationEncryption');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /internal/encrypted-org-id
 * Returns { encryptedOrgId } for quick verification of env-based encryption.
 *
 * Safety:
 * - Disabled by default in production unless a token header is provided.
 * - If NODE_ENV !== 'production', route is enabled without token.
 * - In production, require header: x-internal-token == process.env.INTERNAL_ENCRYPTION_ROUTE_TOKEN
 *
 * Response:
 * 200: { encryptedOrgId: string }
 * 403: { success: false, message: 'Forbidden' }
 * 500: { success: false, message: 'Internal Server Error' }
 */
router.get(
  '/encrypted-org-id',
  asyncHandler(async (req, res) => {
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (isProd) {
      const token = req.header('x-internal-token');
      const expected = process.env.INTERNAL_ENCRYPTION_ROUTE_TOKEN;
      if (!expected || token !== expected) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
    }
    const encryptedOrgId = getEncryptedOrganizationId();
    return res.status(200).json({ encryptedOrgId });
  })
);

module.exports = router;
