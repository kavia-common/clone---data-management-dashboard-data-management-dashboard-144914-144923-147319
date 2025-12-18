'use strict';

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/verify/project-create/summary
 * Quick verification helper: proxies an internal call to /api/project-create/summary
 * and asserts that user_name is present (ensuring users lookup works and replaces user_id display).
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

    const hasTopLevelUserName = json && Object.prototype.hasOwnProperty.call(json, 'user_name');
    const hasInBucketsUserName = Array.isArray(json?.buckets)
      ? json.buckets.some(b => typeof b?.user_name === 'string' && b.user_name.length > 0)
      : false;

    const ok = !!(hasTopLevelUserName || hasInBucketsUserName);
    const note = ok
      ? 'user_name present in response and used for display'
      : 'user_name not found in response';

    res.set('Cache-Control', 'no-store');
    res.set('x-verify-route', 'dev.project-create.summary');
    const diag = {
      query: {
        tenant_id: req.query.tenant_id || req.query.organization_id || req.header('x-organization-id') || null,
        project_id: req.query.project_id || null,
        range: req.query.range || null,
        start_date: req.query.start_date || null,
        end_date: req.query.end_date || null,
      },
      buckets_sample: Array.isArray(json?.buckets) ? json.buckets.slice(0, 5).map(b => ({
        user_name: b?.user_name ?? null,
        project_id: b?.project_id ?? null,
        key: b?.key ?? null,
        count: b?.count ?? null,
      })) : [],
    };
    return res.status(200).json({ ok, note, diagnostics: diag, received: json });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
});

module.exports = router;
