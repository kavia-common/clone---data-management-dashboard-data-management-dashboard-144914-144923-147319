'use strict';

const express = require('express');
const router = express.Router();
const SessionTracking = require('../models/sessionTracking.model');

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/verify/project-create/exact
 * This dev verification route executes the exact MongoDB filter:
 *   tenant_id: exact
 *   project_id: exact (with type coercion if numeric but stored as string)
 *   created_at between [YYYY-MM-DDT00:00:00.000Z, YYYY-MM-DDT23:59:59.999Z]
 *
 * Query:
 *   - tenant_id (required)
 *   - project_id (required; number or string, coerced to DB type)
 *   - date (required; YYYY-MM-DD)
 *
 * Returns:
 *   - { ok: boolean, expectedCount: 1, actualCount: number, filter: {}, sample: {...} }
 */
router.get('/project-create/exact', async (req, res) => {
  try {
    const tenant = req.query.tenant_id || req.query.organization_id || req.headers['x-organization-id'];
    const projectIdRaw = req.query.project_id;
    const dateStr = req.query.date;

    if (!tenant || !projectIdRaw || !dateStr) {
      return res.status(400).json({ ok: false, error: 'tenant_id, project_id and date are required' });
    }

    // Build UTC bounds
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(dateStr)) {
      return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
    }
    const from = new Date(`${dateStr}T00:00:00.000Z`);
    const to = new Date(`${dateStr}T23:59:59.999Z`);

    // Coerce project_id to storage type; schema shows String
    let projectId = String(projectIdRaw);
    const numMaybe = Number(projectIdRaw);
    if (!Number.isNaN(numMaybe) && String(numMaybe) === String(projectIdRaw)) {
      projectId = String(numMaybe);
    }

    const filter = {
      tenant_id: String(tenant),
      project_id: projectId,
      created_at: { $gte: from, $lte: to },
    };

    const actualCount = await SessionTracking.countDocuments(filter);
    const sample = await SessionTracking.findOne(filter).lean();

    return res.status(200).json({
      ok: actualCount === 1,
      expectedCount: 1,
      actualCount,
      filter: {
        ...filter,
        created_at: { $gte: from.toISOString(), $lte: to.toISOString() },
      },
      sample,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

module.exports = router;
