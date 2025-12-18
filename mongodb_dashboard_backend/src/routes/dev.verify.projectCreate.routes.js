'use strict';

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/verify/project-create/summary
 * Quick verification helper: proxies an internal call to /api/project-create/summary
 * and asserts that project_name is present when project_id is provided. This is a
 * lightweight diagnostic route for manual checks in demos/dev environments.
 *
 * Query:
 *  - project_id: string (required)
 *  - tenant_id | organization_id | x-organization-id (one required to compute buckets; but
 *    absence is allowed—verification will then only check top-level project_name resolution)
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

    const hasTopLevel = json && Object.prototype.hasOwnProperty.call(json, 'project_name');
    const hasInBuckets = Array.isArray(json?.buckets)
      ? json.buckets.some(b => typeof b?.project_name === 'string' || b?.project_name === null)
      : false;

    const ok = !!(hasTopLevel || hasInBuckets);
    const note = ok
      ? 'project_name present in response'
      : 'project_name not found; check AppDeployment data for given project_id';

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ ok, note, received: json });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

module.exports = router;
