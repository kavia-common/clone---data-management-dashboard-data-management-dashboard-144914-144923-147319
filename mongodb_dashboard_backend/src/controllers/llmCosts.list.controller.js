'use strict';

const { getDb } = require('../config/db');
const LlmCost = require('../models/llmCosts.model');
const { getDiagnosticsStore } = require('../utils/llmCostsDiagnostics');
const { handleError } = require('../utils/http');

/**
 * Normalize a raw cost document into a UI-friendly tabular record.
 * Adds a "details" object containing raw/extra keys not part of standard columns.
 */
function normalizeItem(doc) {
  const breakdown = doc?.breakdown || {};
  const inputTokens =
    doc?.tokens_in ??
    breakdown?.prompt_tokens ??
    breakdown?.input_tokens ??
    breakdown?.tokens_in ??
    null;
  const outputTokens =
    doc?.tokens_out ??
    breakdown?.completion_tokens ??
    breakdown?.output_tokens ??
    breakdown?.tokens_out ??
    null;
  const model = doc?.model || doc?.llm_model || null;

  // currency and total cost handling
  const currency = doc?.currency || 'USD';
  let costUsd = null;
  if (doc && Object.prototype.hasOwnProperty.call(doc, 'cost_usd')) {
    costUsd = doc.cost_usd;
  } else if (Object.prototype.hasOwnProperty.call(doc || {}, 'total_cost')) {
    costUsd = doc.total_cost;
  } else if (
    typeof breakdown?.input_cost === 'number' ||
    typeof breakdown?.output_cost === 'number'
  ) {
    const a = typeof breakdown?.input_cost === 'number' ? breakdown.input_cost : 0;
    const b = typeof breakdown?.output_cost === 'number' ? breakdown.output_cost : 0;
    costUsd = a + b;
  }
  if (typeof costUsd === 'string') {
    const n = parseFloat(String(costUsd).replace(/^\s*\$/, ''));
    costUsd = Number.isFinite(n) ? n : null;
  }

  // Standard columns for table
  const standard = {
    _id: String(doc?._id || ''),
    request_id: doc?.request_id ?? doc?.task_id ?? null,
    session_id: doc?.session_id ?? null,
    project_id: doc?.project_id ?? null,
    timestamp: doc?.timestamp || doc?.created_at || null,
    created_at: doc?.created_at ?? null,
    model,
    model_version: doc?.model_version ?? doc?.version ?? null,
    provider: doc?.provider ?? null,
    user_id: doc?.user_id ?? null,
    organization_id: doc?.organization_id || doc?.tenant_id || null,
    tenant_id: doc?.tenant_id ?? null,
    tokens_in: Number.isFinite(inputTokens) ? inputTokens : null,
    tokens_out: Number.isFinite(outputTokens) ? outputTokens : null,
    prompt: breakdown?.prompt ?? doc?.prompt ?? null,
    completion: breakdown?.completion ?? doc?.completion ?? null,
    cost_usd: typeof costUsd === 'number' ? costUsd : null,
    total_cost: typeof doc?.total_cost === 'number' ? doc.total_cost : (typeof doc?.total_cost === 'string' ? parseFloat(String(doc.total_cost).replace(/^\s*\$/, '')) : null),
    currency,
    duration_ms: doc?.duration_ms ?? doc?.latency_ms ?? null,
    status: doc?.status ?? null,
    provider_status: doc?.provider_status ?? null,
  };

  // Lightweight breakdown for UI (tokens/costs)
  const breakdownSummary = {
    tokens: {
      prompt: Number.isFinite(breakdown?.prompt_tokens) ? breakdown.prompt_tokens : (Number.isFinite(breakdown?.input_tokens) ? breakdown.input_tokens : null),
      completion: Number.isFinite(breakdown?.completion_tokens) ? breakdown.completion_tokens : (Number.isFinite(breakdown?.output_tokens) ? breakdown.output_tokens : null),
    },
    costs: {
      input: typeof breakdown?.input_cost === 'number' ? breakdown.input_cost : null,
      output: typeof breakdown?.output_cost === 'number' ? breakdown.output_cost : null,
    },
  };

  // "details" raw/extra captures additional keys for optional UI rendering
  const knownKeys = new Set([
    ...Object.keys(standard),
    'breakdown',
    'metadata',
    'extra',
    'details',
  ]);
  const extra = {};
  if (doc && typeof doc === 'object') {
    for (const [k, v] of Object.entries(doc)) {
      if (!knownKeys.has(k)) {
        extra[k] = v;
      }
    }
  }
  // always include raw breakdown and metadata under details
  const details = {
    breakdown,
    breakdown_summary: breakdownSummary,
    metadata: doc?.metadata ?? null,
    raw: extra,
  };

  return { ...standard, details };
}

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
      const allowed = new Set(['timestamp', 'cost_usd', 'tokens_in', 'tokens_out', 'duration_ms', 'status', '_id', 'created_at']);
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

    let windowApplied = '';
    if (!from && !to) {
      to = now;
      from = new Date(now.getTime() - MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000);
      windowApplied = 'default';
    } else if (from && !to) {
      const maxTo = new Date(from.getTime() + MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000);
      to = (maxTo < now ? maxTo : now);
      windowApplied = 'clamped_to';
    } else if (!from && to) {
      const minFrom = new Date(to.getTime() - MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000);
      from = minFrom;
      windowApplied = 'clamped_from';
    } else {
      if ((to - from) > MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000) {
        diag.error = 'date_window_exceeds_max';
        getDiagnosticsStore().set(diag);
        return res.status(400).json({ success: false, error: 'date_window_exceeds_max', maxDays: MAX_DAYS_WINDOW });
      }
    }

    const filter = {
      $or: [
        { organization_id: tenant },
        { tenant_id: tenant },
      ],
      ...(from || to ? { timestamp: Object.assign({}, from ? { $gte: from } : {}, to ? { $lte: to } : {}) } : {}),
    };

    const projection = {
      _id: 1,
      request_id: 1,
      task_id: 1,
      session_id: 1,
      project_id: 1,
      timestamp: 1,
      created_at: 1,
      model: 1,
      llm_model: 1,
      model_version: 1,
      provider: 1,
      provider_status: 1,
      user_id: 1,
      organization_id: 1,
      tenant_id: 1,
      // tokens and textual prompt/completion summaries
      tokens_in: 1,
      tokens_out: 1,
      prompt: 1,
      completion: 1,
      // breakdown tokens + costs
      breakdown: 1,
      'breakdown.prompt_tokens': 1,
      'breakdown.completion_tokens': 1,
      'breakdown.input_tokens': 1,
      'breakdown.output_tokens': 1,
      'breakdown.input_cost': 1,
      'breakdown.output_cost': 1,
      // costs and currency
      cost_usd: 1,
      total_cost: 1,
      currency: 1,
      // durations and status
      duration_ms: 1,
      latency_ms: 1,
      status: 1,
      // metadata free-form details for the UI details panel
      metadata: 1,
      // allow any extra fields to be optionally surfaced in details.raw
      // strict: false ensures extras exist; we still project entire doc keys not listed here via manual pick in code
    };

    diag.filter = filter;
    diag.projection = projection;
    diag.sort = sort;
    diag.page = page;
    diag.limit = limit;

    const parseEnd = Date.now();

    const collection = (await db).collection(LlmCost.collection?.name || LlmCost.collectionName || 'llm-costs');
    const skip = (page - 1) * limit;

    // Build a Mongo sort spec from object
    const sortSpec = sort;

    const cursor = collection.find(filter, { projection }).sort(sortSpec).skip(skip).limit(limit);
    const builtEnd = Date.now();

    const [rawItems, total] = await Promise.all([cursor.toArray(), collection.countDocuments(filter)]);
    const execEnd = Date.now();

    // normalize items to tabular fields
    const items = Array.isArray(rawItems) ? rawItems.map(normalizeItem) : [];

    // headers
    try {
      res.set('x-effective-tenant', String(tenant));
      res.set('x-llm-filter', JSON.stringify(filter));
      res.set('x-llm-projection', JSON.stringify(projection));
      res.set('x-llm-sort', JSON.stringify(sortSpec));
      res.set('x-llm-page', String(page));
      res.set('x-llm-limit', String(limit));
      res.set('x-llm-window-from', from ? from.toISOString() : '');
      res.set('x-llm-window-to', to ? to.toISOString() : '');
      if (typeof windowApplied === 'string' && windowApplied) {
        res.set('x-llm-window-applied', windowApplied);
      }
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
        window: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          applied: windowApplied || null,
        },
        diagnostics: {
          headers: {
            effectiveTenant: String(tenant),
            filter: filter,
            projection,
            sort: sortSpec,
            timings: {
              parsed_ms: parseEnd - startedAt,
              built_ms: builtEnd - parseEnd,
              exec_ms: execEnd - builtEnd
            }
          }
        }
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
