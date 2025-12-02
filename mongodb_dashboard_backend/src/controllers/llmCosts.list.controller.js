'use strict';

const { getDb } = require('../config/db');
const LlmCost = require('../models/llmCosts.model');
const { getDiagnosticsStore } = require('../utils/llmCostsDiagnostics');
const { handleError } = require('../utils/http');

// PUBLIC_INTERFACE
async function listLlmCosts(req, res) {
  /** List LLM cost records (tabular) with enforced guards, timing headers, and diagnostics capture. */
  const startedAt = Date.now();
  const diag = {
    route: 'GET /api/llm-costs',
    tenant: null,
    filter: null,
    projection: null,
    sort: null,
    page: null,
    limit: null,
    timings: {},
    error: null,
  };

  try {
    const db = await getDb();

    // Tenant resolution: JWT precedence handled upstream; expect req.tenantId/organizationId or header/query
    const jwtTenant = req?.auth?.tenantId ? String(req.auth.tenantId) : null;
    const headerTenant = req.headers?.['x-organization-id'] ? String(req.headers['x-organization-id']) : null;
    const queryTenant = (req.query?.tenant_id || req.query?.organization_id) ? String(req.query.tenant_id || req.query.organization_id) : null;

    // If Authorization present and conflicting tenant hints provided, reject
    if (req.headers?.authorization && (headerTenant || queryTenant)) {
      const hinted = headerTenant || queryTenant;
      if (jwtTenant && String(hinted) !== String(jwtTenant)) {
        diag.error = 'tenant_scope_mismatch';
        getDiagnosticsStore().set(diag);
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
      }
    }

    const tenant = jwtTenant || headerTenant || queryTenant || req?.tenantId || req?.organizationId || null;
    diag.tenant = tenant;

    if (!tenant) {
      diag.error = 'missing_tenant';
      getDiagnosticsStore().set(diag);
      return res.status(400).json({ success: false, error: 'missing_tenant' });
    }

    // Pagination guards
    const DEFAULT_PAGE_LIMIT = 20;
    const MAX_PAGE_LIMIT = 200;
    const MAX_DAYS_WINDOW = 90;

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    let limit = parseInt(req.query.limit || DEFAULT_PAGE_LIMIT, 10);
    if (isNaN(limit) || limit < 1) limit = DEFAULT_PAGE_LIMIT;
    if (limit > MAX_PAGE_LIMIT) {
      diag.error = 'limit_exceeds_max';
      getDiagnosticsStore().set(diag);
      return res.status(400).json({ success: false, error: 'limit_exceeds_max', max: MAX_PAGE_LIMIT });
    }

    // Sort guard: only allow index-friendly fields
    let sort = { timestamp: -1 };
    if (req.query.sort) {
      const allowed = new Set(['timestamp', 'cost_usd', 'tokens_in', 'tokens_out', 'duration_ms', 'status']);
      const fields = req.query.sort.split(',').map(s => s.trim()).filter(Boolean);
      const s = {};
      for (const f of fields) {
        const dir = f.startsWith('-') ? -1 : 1;
        const name = f.startsWith('-') ? f.slice(1) : f;
        if (allowed.has(name)) s[name] = dir;
      }
      sort = Object.keys(s).length ? s : { timestamp: -1 };
    }

    // Time window guards on canonical 'timestamp'
    const now = new Date();
    let from = req.query.from ? new Date(req.query.from) : null;
    let to = req.query.to ? new Date(req.query.to) : null;

    if (!from && !to) {
      to = now;
      from = new Date(now.getTime() - MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000);
    } else if (from && !to) {
      const maxTo = new Date(from.getTime() + MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000);
      to = (maxTo < now ? maxTo : now);
    } else if (!from && to) {
      const minFrom = new Date(to.getTime() - MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000);
      from = minFrom;
    } else {
      if ((to - from) > MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000) {
        diag.error = 'date_window_exceeds_max';
        getDiagnosticsStore().set(diag);
        return res.status(400).json({ success: false, error: 'date_window_exceeds_max', maxDays: MAX_DAYS_WINDOW });
      }
    }

    const filter = {
      organization_id: tenant,
      ...(from || to ? { timestamp: Object.assign({}, from ? { $gte: from } : {}, to ? { $lte: to } : {}) } : {}),
    };

    const projection = {
      _id: 1,
      request_id: 1,
      timestamp: 1,
      model: 1,
      provider: 1,
      user_id: 1,
      organization_id: 1,
      tokens_in: 1,
      tokens_out: 1,
      cost_usd: 1,
      duration_ms: 1,
      status: 1,
    };

    diag.filter = filter;
    diag.projection = projection;
    diag.sort = sort;
    diag.page = page;
    diag.limit = limit;

    const parseEnd = Date.now();

    const collection = (await db).collection(LlmCost.collectionName || 'llm_costs');
    const skip = (page - 1) * limit;

    const cursor = collection.find(filter, { projection }).sort(sort).skip(skip).limit(limit);
    const builtEnd = Date.now();

    const [items, total] = await Promise.all([cursor.toArray(), collection.countDocuments(filter)]);
    const execEnd = Date.now();

    // headers
    try {
      res.set('x-effective-tenant', String(tenant));
      res.set('x-llm-filter', JSON.stringify(filter));
      res.set('x-llm-projection', JSON.stringify(projection));
      res.set('x-llm-sort', JSON.stringify(sort));
      res.set('x-llm-page', String(page));
      res.set('x-llm-limit', String(limit));
      res.set('x-llm-timing-parsed-ms', String(parseEnd - startedAt));
      res.set('x-llm-timing-built-ms', String(builtEnd - parseEnd));
      res.set('x-llm-timing-exec-ms', String(execEnd - builtEnd));
    } catch (_) { /* ignore header errors */ }

    // record diagnostics
    diag.timings = {
      parsed_ms: parseEnd - startedAt,
      built_ms: builtEnd - parseEnd,
      exec_ms: execEnd - builtEnd,
      total_ms: Date.now() - startedAt,
    };
    getDiagnosticsStore().set(diag);

    return res.status(200).json({
      success: true,
      data: items,
      meta: {
        page,
        limit,
        total,
        sort: req.query.sort || '-timestamp',
      },
    });
  } catch (err) {
    diag.error = err?.message || 'unknown_error';
    getDiagnosticsStore().set(diag);
    return handleError(res, err);
  }
}

module.exports = {
  listLlmCosts,
};
