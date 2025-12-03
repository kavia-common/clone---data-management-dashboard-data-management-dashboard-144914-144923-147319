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

  // Normalize token counts with fallbacks from breakdown
  const inputTokens =
    (Number.isFinite(doc?.tokens_in) ? doc.tokens_in : null) ??
    (Number.isFinite(breakdown?.prompt_tokens) ? breakdown.prompt_tokens : null) ??
    (Number.isFinite(breakdown?.input_tokens) ? breakdown.input_tokens : null) ??
    (Number.isFinite(breakdown?.tokens_in) ? breakdown.tokens_in : null) ??
    null;

  const outputTokens =
    (Number.isFinite(doc?.tokens_out) ? doc.tokens_out : null) ??
    (Number.isFinite(breakdown?.completion_tokens) ? breakdown.completion_tokens : null) ??
    (Number.isFinite(breakdown?.output_tokens) ? breakdown.output_tokens : null) ??
    (Number.isFinite(breakdown?.tokens_out) ? breakdown.tokens_out : null) ??
    null;

  // Normalize model with llm_model fallback
  const model = doc?.model || doc?.llm_model || null;

  // currency and total cost handling
  const currency = doc?.currency || 'USD';

  // cost_usd normalized with total_cost fallback and string parsing
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

  // Standard columns for table (ensure all required fields exist)
  const standard = {
    _id: String(doc?._id || ''),
    request_id: doc?.request_id ?? doc?.task_id ?? null,
    timestamp: doc?.timestamp || doc?.created_at || null,
    model,
    provider: doc?.provider ?? null,
    user_id: doc?.user_id ?? null,
    organization_id: doc?.organization_id || doc?.tenant_id || null,
    tokens_in: Number.isFinite(inputTokens) ? inputTokens : null,
    tokens_out: Number.isFinite(outputTokens) ? outputTokens : null,
    cost_usd: typeof costUsd === 'number' ? costUsd : null,
    duration_ms: doc?.duration_ms ?? doc?.latency_ms ?? null,
    status: doc?.status ?? null,

    // Extra required fields per spec
    session_id: doc?.session_id ?? null,
    project_id: doc?.project_id ?? null,
    currency,
    created_at: doc?.created_at ?? null,
    // Spec mentions llm_model fallback for 'model' already above
    // Include tenant_id as passthrough (not a primary spec field but helpful)
    tenant_id: doc?.tenant_id ?? null,
    model_version: doc?.model_version ?? doc?.version ?? null,
    provider_status: doc?.provider_status ?? null,
    total_cost:
      typeof doc?.total_cost === 'number'
        ? doc.total_cost
        : typeof doc?.total_cost === 'string'
        ? parseFloat(String(doc.total_cost).replace(/^\s*\$/, ''))
        : null,
    // Optional textual summaries if provided
    prompt: (doc?.prompt ?? breakdown?.prompt) ?? null,
    completion: (doc?.completion ?? breakdown?.completion) ?? null,
  };

  // Lightweight breakdown for UI (tokens/costs)
  const breakdownSummary = {
    tokens: {
      prompt: Number.isFinite(breakdown?.prompt_tokens)
        ? breakdown.prompt_tokens
        : Number.isFinite(breakdown?.input_tokens)
        ? breakdown.input_tokens
        : null,
      completion: Number.isFinite(breakdown?.completion_tokens)
        ? breakdown.completion_tokens
        : Number.isFinite(breakdown?.output_tokens)
        ? breakdown.output_tokens
        : null,
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

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 * Efficient, single-query LLM costs listing with strict windowing and guardrails to avoid 504 timeouts.
 * - Uses a single find() with projection/sort/skip/limit (or limit=all cap) and returns data directly.
 * - Enforces MAX_DAYS_WINDOW on timestamp filter.
 * - Supports ?limit=all (bounded by MAX_ALL_LIMIT) or ?all=true to fetch up to MAX_ALL_LIMIT without countDocuments.
 * - Skips countDocuments when returning all results to reduce load/latency.
 * - Configures cursor with lean options (batchSize) and maxTimeMS for server-side execution bounds.
 * - Adds Promise.race timeout fallback to ensure timely response with clear message.
 * - Ensures tenant filtering hits indexed fields (tenant_id or organization_id).
 * - Optional diagnostics=false to skip envelope diagnostics overhead.
 */
async function listLlmCosts(req, res) {
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

  // Adjustable constants
  const DEFAULT_PAGE_LIMIT = 50;
  const MAX_PAGE_LIMIT = 200;
  const MAX_DAYS_WINDOW = Number(process.env.LLMCOSTS_MAX_DAYS_WINDOW || 7); // strict 7-day default window
  const MAX_ALL_LIMIT = Number(process.env.LLMCOSTS_MAX_ALL_LIMIT || 20000);
  const CURSOR_BATCH_SIZE = Number(process.env.LLMCOSTS_CURSOR_BATCH_SIZE || 200); // lower batch to smooth memory
  const DB_MAX_TIME_MS = Number(process.env.LLMCOSTS_MAX_TIME_MS || 4000); // hard cap for DB work
  const HANDLER_TIMEOUT_MS = Number(process.env.LLMCOSTS_HANDLER_TIMEOUT_MS || 5000); // fast-fail 504

  // diagnostics flag: DEFAULT TO FALSE to reduce overhead unless explicitly enabled
  const diagnosticsEnabled = String(req.query.diagnostics || 'false').toLowerCase() !== 'false';

  try {
    const db = await getDb();

    // Tenant resolution
    const jwtTenant = req?.auth?.tenantId ? String(req.auth.tenantId) : null;
    const headerTenant = req.headers?.['x-organization-id'] ? String(req.headers['x-organization-id']) : null;
    const queryTenant = (req.query?.tenant_id || req.query?.organization_id)
      ? String(req.query.tenant_id || req.query.organization_id)
      : null;

    // Enforce scope when JWT present
    if (req.headers?.authorization && (headerTenant || queryTenant)) {
      const hinted = headerTenant || queryTenant;
      if (jwtTenant && String(hinted) !== String(jwtTenant)) {
        diag.error = 'tenant_scope_mismatch';
        if (diagnosticsEnabled) getDiagnosticsStore().set(diag);
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
      }
    }

    // Resolve tenant preferring explicit organization_id when provided to align with org-based indexes
    const tenant =
      (req.query?.organization_id ? String(req.query.organization_id) : null) ||
      (headerTenant ? String(headerTenant) : null) ||
      (jwtTenant ? String(jwtTenant) : null) ||
      (req?.tenantId ? String(req.tenantId) : null) ||
      (req?.organizationId ? String(req.organizationId) : null) ||
      (queryTenant ? String(queryTenant) : null) ||
      null;
    diag.tenant = tenant;
    if (!tenant) {
      diag.error = 'missing_tenant';
      if (diagnosticsEnabled) getDiagnosticsStore().set(diag);
      return res.status(400).json({ success: false, error: 'missing_tenant' });
    }

    // limit=all or all=true handling with caps
    const wantsAll = (String(req.query.limit || '').toLowerCase() === 'all') ||
                     (String(req.query.all || '').toLowerCase() === 'true');

    const page = wantsAll ? 1 : Math.max(parseInt(req.query.page || '1', 10), 1);
    let limit;
    if (wantsAll) {
      limit = MAX_ALL_LIMIT; // cap server-side
    } else {
      const parsedLimit = parseInt(req.query.limit || DEFAULT_PAGE_LIMIT, 10);
      limit = isNaN(parsedLimit) || parsedLimit < 1 ? DEFAULT_PAGE_LIMIT : parsedLimit;
      if (limit > MAX_PAGE_LIMIT) {
        diag.error = 'limit_exceeds_max';
        if (diagnosticsEnabled) getDiagnosticsStore().set(diag);
        return res.status(400).json({ success: false, error: 'limit_exceeds_max', max: MAX_PAGE_LIMIT });
      }
    }

    // Sort guard: only allow index-friendly fields
    let sort = { timestamp: -1 };
    if (req.query.sort) {
      const allowed = new Set([
        'timestamp',
        '_id',
        'total_cost',
        'cost_usd',
        'tokens_in',
        'tokens_out',
        'duration_ms',
        'status',
        'created_at',
      ]);
      const fields = req.query.sort
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
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
      to = maxTo < now ? maxTo : now;
      windowApplied = 'clamped_to';
    } else if (!from && to) {
      const minFrom = new Date(to.getTime() - MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000);
      from = minFrom;
      windowApplied = 'clamped_from';
    } else {
      if (to - from > MAX_DAYS_WINDOW * 24 * 60 * 60 * 1000) {
        diag.error = 'date_window_exceeds_max';
        if (diagnosticsEnabled) getDiagnosticsStore().set(diag);
        return res
          .status(400)
          .json({ success: false, error: 'date_window_exceeds_max', maxDays: MAX_DAYS_WINDOW });
      }
    }

    // Effective filter (ensure indexed fields used)
    // Choose a single indexed field for the tenant filter to guarantee use of a compound index
    // Prefer tenant_id; fall back to organization_id
    // Select effective tenant key:
    // - If the client provided organization_id, strictly use organization_id to align with its index.
    // - Else use tenant_id by default (or env override).
    const tenantFieldDefault = 'tenant_id';
    const useOrgEnv = String(process.env.LLMCOSTS_USE_ORG_ALIAS || '').toLowerCase() === 'true';
    const providedOrgId = req.query?.organization_id || headerTenant; // header is x-organization-id
    const effectiveTenantKey = providedOrgId ? 'organization_id' : (useOrgEnv ? 'organization_id' : tenantFieldDefault);

    const filter = {
      [effectiveTenantKey]: tenant,
      ...(from || to
        ? {
            timestamp: Object.assign(
              {},
              from ? { $gte: from } : {},
              to ? { $lte: to } : {}
            ),
          }
        : {}),
    };
    // lightweight timing breadcrumb
    if (process.env.DEBUG_LLMCOSTS_TIMING === '1') {
      console.log('[llm-costs] filter built', { key: effectiveTenantKey, hasFrom: !!from, hasTo: !!to });
    }

    // Whitelisted optional filter json parsing (skip heavy validation)
    if (req.query.filter) {
      try {
        const userFilter = JSON.parse(req.query.filter);
        const whitelist = new Set(['status','provider','llm_model','user_id','session_id','project_id','request_id']);
        for (const [k, v] of Object.entries(userFilter || {})) {
          if (whitelist.has(k)) {
            filter[k] = v;
          }
        }
      } catch {
        // ignore invalid filter JSON to avoid 500s
      }
    }

    // Minimal projection
    const includeDetails = String(req.query.includeDetails || 'false').toLowerCase() === 'true';
    const projection = {
      _id: 1,
      request_id: 1,
      task_id: 1,
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
      session_id: 1,
      project_id: 1,
      tokens_in: 1,
      tokens_out: 1,
      // Exclude heavy text fields unless explicitly requested
      ...(includeDetails ? { prompt: 1, completion: 1 } : { prompt: 0, completion: 0 }),
      // Exclude heavy nested fields unless explicitly requested
      ...(includeDetails
        ? {
            breakdown: 1,
            metadata: 1,
          }
        : {
            breakdown: 0,
            metadata: 0,
          }),
      // Keep minimal fields for cost calc
      'breakdown.prompt_tokens': 1,
      'breakdown.completion_tokens': 1,
      'breakdown.input_tokens': 1,
      'breakdown.output_tokens': 1,
      'breakdown.input_cost': 1,
      'breakdown.output_cost': 1,
      cost_usd: 1,
      total_cost: 1,
      currency: 1,
      duration_ms: 1,
      latency_ms: 1,
      status: 1,
    };

    diag.filter = filter;
    diag.projection = projection;
    diag.sort = sort;
    diag.page = page;
    diag.limit = limit;

    const parseEnd = Date.now();

    // Ensure indexes exist (non-blocking best-effort)
    try {
      const { ensureLlmCostsIndexes } = require('../models/llmCosts.indexes');
      // Do not await to avoid long blocks; fire-and-forget in background
      Promise.resolve(ensureLlmCostsIndexes()).catch(() => {});
    } catch (_) {}

    const collection = (await db).collection(
      LlmCost.collection?.name || LlmCost.collectionName || 'llm-costs'
    );
    const skip = (page - 1) * limit;
    const sortSpec = sort;

    // Build the base cursor with performance options
    let cursor = collection
      .find(filter, { projection })
      .sort(sortSpec)
      .batchSize(CURSOR_BATCH_SIZE)
      .maxTimeMS(DB_MAX_TIME_MS);

    if (!wantsAll) {
      cursor = cursor.skip(skip).limit(limit);
    } else {
      cursor = cursor.limit(MAX_ALL_LIMIT);
    }

    const builtEnd = Date.now();
    if (process.env.DEBUG_LLMCOSTS_TIMING === '1') {
      console.log('[llm-costs] timings', { parsed_ms: parseEnd - startedAt, built_ms: builtEnd - parseEnd });
    }

    // Execute with internal timeout guard
    const execPromise = (async () => {
      const rawItems = await cursor.toArray();

      // Run countDocuments only when explicitly requested via ?total=true and pagination is requested.
      let total = null;
      const wantsTotal = String(req.query.total || 'false').toLowerCase() === 'true';
      if (!wantsAll && wantsTotal) {
        try {
          total = await collection.countDocuments(filter, {
            maxTimeMS: Math.max(1000, Math.floor(DB_MAX_TIME_MS * 0.75)),
          });
        } catch {
          // degrade gracefully
          total = null;
        }
      }
      return { rawItems, total };
    })();

    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ timeout: true });
      }, HANDLER_TIMEOUT_MS).unref?.();
    });

    const result = await Promise.race([execPromise, timeoutPromise]);
    const execEnd = Date.now();
    if (process.env.DEBUG_LLMCOSTS_TIMING === '1') {
      console.log('[llm-costs] exec_ms', execEnd - builtEnd);
    }

    if (result && result.timeout) {
      // Timeout: return clear message without crashing
      diag.error = 'handler_timeout';
      diag.timings = {
        parsed_ms: parseEnd - startedAt,
        built_ms: builtEnd - parseEnd,
        exec_ms: execEnd - builtEnd,
        total_ms: Date.now() - startedAt,
      };
      if (diagnosticsEnabled) getDiagnosticsStore().set(diag);

      try {
        res.set('x-effective-tenant', String(tenant));
        res.set('x-llm-filter', JSON.stringify(filter));
        res.set('x-llm-projection', JSON.stringify(projection));
        res.set('x-llm-sort', JSON.stringify(sortSpec));
        res.set('x-llm-page', String(page));
        res.set('x-llm-limit', wantsAll ? 'all' : String(limit));
        res.set('x-llm-window-from', from ? from.toISOString() : '');
        res.set('x-llm-window-to', to ? to.toISOString() : '');
        if (typeof windowApplied === 'string' && windowApplied) {
          res.set('x-llm-window-applied', windowApplied);
        }
        res.set('x-llm-timing-parsed-ms', String(parseEnd - startedAt));
        res.set('x-llm-timing-built-ms', String(builtEnd - parseEnd));
        res.set('x-llm-timing-exec-ms', String(execEnd - builtEnd));
      } catch {}

      return res.status(504).json({
        success: false,
        error: 'timeout',
        message: 'The request exceeded the time limit. Try narrowing the date window or removing non-indexed filters.',
      });
    }

    const rawItems = Array.isArray(result?.rawItems) ? result.rawItems : [];
    const total = result?.total == null ? (wantsAll ? rawItems.length : 0) : result.total;

    // Normalize without secondary queries
    const items = rawItems.map(normalizeItem);

    // Headers
    try {
      res.set('x-effective-tenant', String(tenant));
      res.set('x-llm-filter', JSON.stringify(filter));
      res.set('x-llm-projection', JSON.stringify(projection));
      res.set('x-llm-sort', JSON.stringify(sortSpec));
      res.set('x-llm-page', String(page));
      res.set('x-llm-limit', wantsAll ? 'all' : String(limit));
      res.set('x-llm-window-from', from ? from.toISOString() : '');
      res.set('x-llm-window-to', to ? to.toISOString() : '');
      if (typeof windowApplied === 'string' && windowApplied) {
        res.set('x-llm-window-applied', windowApplied);
      }
      res.set('x-llm-timing-parsed-ms', String(parseEnd - startedAt));
      res.set('x-llm-timing-built-ms', String(builtEnd - parseEnd));
      res.set('x-llm-timing-exec-ms', String(execEnd - builtEnd));
    } catch {}

    // Record diagnostics (optional)
    diag.timings = {
      parsed_ms: parseEnd - startedAt,
      built_ms: builtEnd - parseEnd,
      exec_ms: execEnd - builtEnd,
      total_ms: Date.now() - startedAt,
    };
    if (diagnosticsEnabled) getDiagnosticsStore().set(diag);

    return res.status(200).json({
      success: true,
      data: items,
      meta: {
        page,
        limit: wantsAll ? MAX_ALL_LIMIT : limit,
        total,
        sort: req.query.sort || '-timestamp',
        window: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          applied: windowApplied || null,
        },
        diagnostics: diagnosticsEnabled
          ? {
              headers: {
                effectiveTenant: String(tenant),
                filter,
                projection,
                sort: sortSpec,
                timings: {
                  parsed_ms: parseEnd - startedAt,
                  built_ms: builtEnd - parseEnd,
                  exec_ms: execEnd - builtEnd,
                },
              },
            }
          : undefined,
      },
    });
  } catch (err) {
    diag.error = err?.message || 'unknown_error';
    if (diagnosticsEnabled) getDiagnosticsStore().set(diag);
    return handleError(res, err);
  }
}

module.exports = {
  listLlmCosts,
};
