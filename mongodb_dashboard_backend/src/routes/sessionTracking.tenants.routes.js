'use strict';

const express = require('express');
const SessionTracking = require('../models/sessionTracking.model');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/tenants/distinct
 *
 * Purpose:
 * - Returns all distinct tenant ids present in the session_tracking collection.
 * - This is a dataset-derived list used to populate the Session Tracking "Filter by Tenant ID" dropdown.
 *
 * Contract:
 * - Inputs:
 *   - No required query params.
 * - Outputs:
 *   - 200: { success: true, items: string[] }
 *     where items is a sorted array of non-empty tenant_id strings.
 * - Errors:
 *   - 500: { success: false, message: string }
 *
 * Notes / invariants:
 * - Uses SessionTracking.distinct('tenant_id') as the canonical source.
 * - Filters out null/empty/whitespace-only values.
 * - Sorting is server-side for stable UX.
 */
router.get(
  '/distinct',
  asyncHandler(async (req, res) => {
    try {
      const raw = await SessionTracking.distinct('tenant_id', { tenant_id: { $exists: true } });

      const items = (Array.isArray(raw) ? raw : [])
        .map((t) => (t == null ? '' : String(t).trim()))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      return res.status(200).json({ success: true, items });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: 'Failed to load distinct tenant ids from session_tracking',
        details: err?.message || String(err),
      });
    }
  })
);

module.exports = router;
