'use strict';

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/verify/project-create/summary
 * Quick verification helper: proxies an internal call to /api/project-create/summary
 * and asserts that user_id is present (replacing prior project_id display).
 *
 * Query:
 *  - project_id: string (optional, preserved for compatibility; will be echoed as user_id)
 *  - tenant_id | organization_id | x-organization-id (optional)
 *
 * Returns:
 *  - { ok: boolean, note: string, received: any }
 */
router.get('/project-create/summary', async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const url = new URL('/api/project-create/summary', base);
    if (req.query.project_id) url.searchParams.set('project_id', req.query.project_id);
    if (req.query.tenant_id) url.searchParams.set('tenant_id', req.query.tenant_id);
    if (req.query.organization_id) url.searchParams.set('organization_id', req.query.organization_id);
    if (req.query.range) url.searchParams.set('range', req.query.range);
    if (req.query.start_date) url.searchParams.set('start_date', req.query.start_date);
    if (req.query.end_date) url.searchParams.set('end_date', req.query.end_date);

    const headers = {};
    const hdrTenant = req.header('x-organization-id');
    if (hdrTenant) headers['x-organization-id'] = hdrTenant;

    // Use a timeout to prevent hanging verification
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('fetch-timeout'), 5000);

    let json;
    try {
      const r = await fetch(url.toString(), { headers, signal: controller.signal });
      const contentType = r.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        json = await r.json();
      } else {
        const text = await r.text();
        json = { nonJson: true, status: r.status, body: text };
      }
    } finally {
      clearTimeout(timeout);
    }

    const hasTopLevelUserId = json && Object.prototype.hasOwnProperty.call(json, 'user_id');
    const hasInBucketsUserId = Array.isArray(json?.buckets)
      ? json.buckets.some(b => typeof b?.user_id === 'string')
      : false;

    const ok = !!(hasTopLevelUserId || hasInBucketsUserId);
    const note = ok
      ? 'user_id present in response (replacing project_id display)'
      : 'user_id not found in response';

    res.set('Cache-Control', 'no-store');
    res.set('x-verify-route', 'dev.project-create.summary');
    return res.status(200).json({ ok, note, received: json });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
});

module.exports = router;
