'use strict';

const mongoose = require('mongoose');
const { success } = require('../utils/http');
const { getCollection } = require('../config/db');
const { getDiagnosticsStore } = require('../utils/llmCostsDiagnostics');

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 * GET /api/llm-costs
 *
 * Efficient, index-friendly list endpoint for LLM costs:
 * - Enforces tenant scoping (JWT > header > query aliases). If Authorization is provided and client-supplied tenant differs, returns 403.
 * - Applies a bounded time window on canonical field "timestamp" with MAX_DAYS_WINDOW (default 90 days).
 * - Enforces pagination with upper bound limit=200. limit=all and all=true are supported up to MAX_ALL_LIMIT.
 * - Uses projections to keep documents small and avoid full collection scans.
 * - Adds debug/diagnostic headers and captures minimal diagnostics for /api/llm-costs/diagnostics endpoints.
 */
async function listLlmCosts(req, res) {
  const t0 = Date.now();
  const headers = (name, value) => {
    try { res.set(name, String(value)); } catch {}
  };

  const MAX_DAYS_WINDOW = Number(process.env.LLMCOSTS_MAX_DAYS_WINDOW || 90);
  const DEFAULT_PAGE_LIMIT = Number(process.env.LLMCOSTS_DEFAULT_LIMIT || 50);
  const MAX_LIMIT = 200;
  const MAX_ALL_LIMIT = Number(process.env.LLMCOSTS_MAX_ALL_LIMIT || 2000);
  const DEBUG_EXPLAIN = String(process.env.DEBUG_LLMCOSTS_EXPLAIN || '') === '1';

  // Resolve tenant scoping
  const jwtTenant = req?.auth?.tenantId ? String(req.auth.tenantId) : (req.tenantId ? String(req.tenantId) : '');
  const headerTenant = (req.headers['x-organization-id'] || req.headers['x-tenant-id'] || req.headers['x-tenant'] || '').toString().trim();
  const queryTenant = (req.query.organization_id || req.query.tenant_id || '').toString().trim();
  const clientTenant = headerTenant || queryTenant || '';
  if (req.headers?.authorization && clientTenant && jwtTenant && clientTenant !== jwtTenant) {
    return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
  }
  const resolvedTenant = jwtTenant || clientTenant || '';
  if (!resolvedTenant) {
    return res.status(400).json({ success: false, message: 'Missing tenant: provide Authorization or x-organization-id header.' });
  }
  headers('x-effective-tenant', resolvedTenant);

  // Parse window
  const now = new Date();
  const fromQ = req.query.from ? new Date(req.query.from) : null;
  const toQ = req.query.to ? new Date(req.query.to) : null;
  let from = null;
  let to = null;
  let windowApplied = null;

  const clampWindow = (start, end) => {
    const maxMs = MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000;
    if (start && end && (end - start) > maxMs) {
      return { error: true };
    }
    if (start && !end) {
      const maybeEnd = new Date(start.getTime() + maxMs);
      return { start, end: maybeEnd, applied: 'clamped_to' };
    }
    if (!start && end) {
      const maybeStart = new Date(end.getTime() - maxMs);
      return { start: maybeStart, end, applied: 'clamped_from' };
    }
    if (!start && !end) {
      const startDefault = new Date(now.getTime() - maxMs);
      return { start: startDefault, end: now, applied: 'default' };
    }
    return { start, end, applied: null };
  };

  if (fromQ && isFinite(fromQ.getTime())) from = fromQ;
  if (toQ && isFinite(toQ.getTime())) to = toQ;
  const w = clampWindow(from, to);
  if (w.error) {
    return res.status(400).json({ success: false, message: `Date window exceeds maximum of ${MAX_DAYS_WINDOW} days.` });
  }
  from = w.start;
  to = w.end;
  windowApplied = w.applied;
  if (from) headers('x-llm-window-from', from.toISOString());
  if (to) headers('x-llm-window-to', to.toISOString());
  if (windowApplied) headers('x-llm-window-applied', windowApplied);

  // Parse filter allowlist and ignore tenant keys from client
  const tParse = Date.now();
  let filter = {};
  const ALLOWED_FIELDS = new Set(['status', 'provider', 'llm_model', 'model', 'user_id', 'session_id', 'project_id', 'request_id']);
  if (req.query.filter) {
    try {
      const raw = JSON.parse(req.query.filter);
      for (const [k, v] of Object.entries(raw || {})) {
        if (['tenant_id', 'organization_id', 'tenantId', 'organizationId', 'orgId'].includes(k)) continue;
        if (ALLOWED_FIELDS.has(k)) filter[k] = v;
      }
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }
  }
  // Inject tenant filter
  const tenantFilter = {
    $or: [
      { tenant_id: resolvedTenant },
      { organization_id: resolvedTenant },
      { orgId: resolvedTenant },
      { tenantId: resolvedTenant },
      { organizationId: resolvedTenant },
      { 'tenant.tenant_id': resolvedTenant },
    ],
  };

  // Apply time window on canonical field 'timestamp'
  const timeFilter = {
    timestamp: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) },
  };

  // Final filter
  const effectiveFilter = Object.keys(filter).length
    ? { $and: [tenantFilter, timeFilter, filter] }
    : { $and: [tenantFilter, timeFilter] };

  // Pagination and sorting
  let page = Number(req.query.page || 1);
  if (!Number.isFinite(page) || page <= 0) page = 1;

  let limit;
  const wantsAll = String(req.query.all || '').toLowerCase() === 'true' || String(req.query.limit || '').toLowerCase() === 'all';
  if (wantsAll) {
    limit = Math.min(MAX_ALL_LIMIT, MAX_LIMIT); // hard cap by MAX_LIMIT to stay responsive; use MAX_ALL_LIMIT cursor in batches if needed later
  } else {
    limit = Number(req.query.limit || DEFAULT_PAGE_LIMIT);
    if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_PAGE_LIMIT;
    if (limit > MAX_LIMIT) {
      return res.status(400).json({ success: false, message: `limit must be <= ${MAX_LIMIT}` });
    }
  }
  let sort = {};
  if (req.query.sort) {
    const s = String(req.query.sort);
    if (s.startsWith('-')) {
      sort[s.slice(1)] = -1;
    } else {
      sort[s] = 1;
    }
  } else {
    sort = { timestamp: -1 };
  }

  // Projection: Keep commonly used fields only
  const projection = {
    _id: 1,
    request_id: 1,
    session_id: 1,
    project_id: 1,
    timestamp: 1,
    created_at: 1,
    model: 1,
    model_version: 1,
    provider: 1,
    provider_status: 1,
    user_id: 1,
    organization_id: 1,
    tenant_id: 1,
    tokens_in: 1,
    tokens_out: 1,
    cost_usd: 1,
    total_cost: 1,
    currency: 1,
    duration_ms: 1,
    status: 1,
  };

  const tBuilt = Date.now();
  headers('x-llm-filter', JSON.stringify(effectiveFilter));
  headers('x-llm-projection', JSON.stringify(projection));
  headers('x-llm-sort', JSON.stringify(sort));
  headers('x-llm-page', String(page));
  headers('x-llm-limit', String(limit));
  headers('x-llm-timing-parsed-ms', String(tParse - t0));
  headers('x-llm-timing-built-ms', String(tBuilt - tParse));

  // DB execution with defensive timeouts
  const collection = await getCollection(['llm_cost', 'llm_costs', 'llm-costs', 'llm_events', 'llm-events']);
  const skip = (page - 1) * limit;

  // Use maxTimeMS to avoid 504s on slow queries
  const QUERY_TIMEOUT_MS = Number(process.env.LLMCOSTS_QUERY_TIMEOUT_MS || 4500);

  const execStart = Date.now();
  const cursor = collection
    .find(effectiveFilter, { projection })
    .sort(sort)
    .skip(skip)
    .limit(limit);

  let data = [];
  try {
    data = await cursor.maxTimeMS(QUERY_TIMEOUT_MS).toArray();
  } catch (err) {
    // On timeout, relax sort to {_id:-1} which often uses default index, and retry once quickly.
    try {
      const fallbackSort = { _id: -1 };
      headers('x-llm-sort', JSON.stringify(fallbackSort));
      data = await collection
        .find(effectiveFilter, { projection })
        .sort(fallbackSort)
        .skip(skip)
        .limit(limit)
        .maxTimeMS(Math.min(QUERY_TIMEOUT_MS, 3000))
        .toArray();
    } catch (e2) {
      return res.status(500).json({ success: false, message: 'Query timed out', error: e2?.message || 'timeout' });
    }
  }
  const total = await collection
    .countDocuments(effectiveFilter, { maxTimeMS: Math.min(QUERY_TIMEOUT_MS, 4000) })
    .catch(() => -1);

  const execMs = Date.now() - execStart;
  headers('x-llm-timing-exec-ms', String(execMs));

  // Optional explain capture (headers only, keep payload minimal)
  if (DEBUG_EXPLAIN) {
    try {
      const explainFind = await collection
        .find(effectiveFilter, { projection })
        .sort(sort)
        .skip(skip)
        .limit(1)
        .explain('executionStats');
      headers('x-llm-explain-find', JSON.stringify({ stage: explainFind?.queryPlanner?.winningPlan?.stage || 'unknown' }));
    } catch {}
    try {
      const explainCount = await collection
        .find(effectiveFilter)
        .limit(1)
        .explain('executionStats');
      headers('x-llm-explain-count', JSON.stringify({ stage: explainCount?.queryPlanner?.winningPlan?.stage || 'unknown' }));
    } catch {}
  }

  // Diagnostics snapshot for /diagnostics
  try {
    getDiagnosticsStore().set({
      when: new Date().toISOString(),
      filter: effectiveFilter,
      sort,
      projection,
      page,
      limit,
      window: { from, to, applied: windowApplied },
      timings: {
        parsed_ms: tParse - t0,
        built_ms: tBuilt - tParse,
        exec_ms: execMs,
      },
      total_hint: total,
    });
  } catch {}

  return res.status(200).json({
    success: true,
    data,
    meta: {
      page,
      limit,
      total,
      sort: Object.keys(sort).length ? Object.keys(sort).map(k => `${sort[k] === -1 ? '-' : ''}${k}`).join(',') : '',
      window: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        applied: windowApplied || null,
      },
      diagnostics: { headers: {} },
      debug: DEBUG_EXPLAIN ? {
        filter: effectiveFilter,
        sort,
        projection,
      } : undefined,
    },
  });
}

module.exports = { listLlmCosts };
