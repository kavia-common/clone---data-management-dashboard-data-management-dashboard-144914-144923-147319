'use strict';

const mongoose = require('mongoose');
const LlmCost = require('../models/llmCosts.model');
const { ensureLlmCostsIndexes } = require('../models/llmCosts.indexes');

// In-memory last diagnostics snapshot for lightweight retrieval
let lastDiagnostics = null;

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 * List LLM cost records with tenant scoping, pagination, projection, and optional diagnostics.
 * - Always returns an envelope: { success, data, meta }
 * - Enforces tenant from JWT when Authorization is provided; otherwise from x-organization-id header (or aliases).
 * - filter whitelist: status, provider, llm_model, user_id, session_id, project_id, request_id
 * Diagnostics:
 * - If DEBUG_LLMCOSTS_EXPLAIN=1, capture explain() for find and count via driver and log to console.
 * - Adds response headers: x-effective-tenant, x-llm-filter, x-llm-projection, x-llm-sort, x-llm-page, x-llm-limit, x-llm-used-or-on-time
 * - Adds timing headers: x-llm-timing-parsed-ms, x-llm-timing-built-ms, x-llm-timing-exec-ms, x-llm-timing-explain-ms (when enabled).
 * - meta.debug contains summarized explain when enabled (compact stats).
 * - On error/timeout, partial headers are set and a diagnostics snapshot is persisted for later retrieval.
 */
async function listLlmCosts(req, res) {
  const t0 = process.hrtime.bigint();
  const timings = {};
  const mark = (label) => {
    timings[label] = Number(process.hrtime.bigint() - t0) / 1e6; // ms since start
  };

  // Wrap entire handler to still set diagnostic headers on error
  try {
    // Best-effort ensure critical indexes exist (non-blocking on failure)
    try {
      await ensureLlmCostsIndexes();
    } catch (e) {
      // Ignore failures; queries will still run and explains will capture any missing index issues
    }

    // Resolve tenant
    const headerTenant =
      (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers?.['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      '';
    const queryTenant =
      (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
      '';
    const jwtTenant = req?.tenantId || req?.organizationId || (req?.auth?.tenantId ? String(req.auth.tenantId) : undefined);

    let effectiveTenant;
    if (req.headers?.authorization) {
      // Authorization present: enforce JWT tenant
      if (headerTenant && jwtTenant && String(headerTenant) !== String(jwtTenant)) {
        setPartialHeaders(res, { effectiveTenant: jwtTenant ?? headerTenant, timings });
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
      }
      if (queryTenant && jwtTenant && String(queryTenant) !== String(jwtTenant)) {
        setPartialHeaders(res, { effectiveTenant: jwtTenant ?? queryTenant, timings });
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
      }
      effectiveTenant = jwtTenant;
    } else {
      effectiveTenant = headerTenant || queryTenant;
    }

    if (!effectiveTenant) {
      setPartialHeaders(res, { effectiveTenant: '', timings });
      return res.status(400).json({ success: false, message: 'Missing tenant: provide Authorization with tenant or x-organization-id header' });
    }

    // Pagination and sort
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const maxLimit = 200;
    const defaultLimit = 50;
    const limit = Math.min(Math.max(parseInt(req.query.limit || String(defaultLimit), 10) || defaultLimit, 1), maxLimit);
    // Default sort by canonical time field
    const sortStr = typeof req.query.sort === 'string' && req.query.sort.trim() ? req.query.sort.trim() : '-timestamp';

    let sort = { timestamp: -1 };
    if (sortStr) {
      if (sortStr.startsWith('-')) {
        sort = { [sortStr.slice(1)]: -1 };
      } else {
        sort = { [sortStr]: 1 };
      }
    }

    // Filter parsing with whitelist
    const allowed = ['status', 'provider', 'llm_model', 'user_id', 'session_id', 'project_id', 'request_id'];
    let rawFilter = {};
    if (typeof req.query.filter === 'string' && req.query.filter.trim()) {
      try {
        rawFilter = JSON.parse(req.query.filter);
      } catch (e) {
        setPartialHeaders(res, { effectiveTenant, timings, page, limit, sort, filter: {}, usedOrOnTime: false });
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }
    const filter = Object.fromEntries(Object.entries(rawFilter).filter(([k]) => allowed.includes(k)));

    // Time range filter applied only on canonical timestamp (no $or across created_at)
    const range = {};
    if (req.query.from) {
      const d = new Date(req.query.from);
      if (!isNaN(d.getTime())) range.$gte = d;
    }
    if (req.query.to) {
      const d = new Date(req.query.to);
      if (!isNaN(d.getTime())) range.$lte = d;
    }
    const timeFilter = Object.keys(range).length ? { timestamp: range } : {};
    const usedOrOnTime = Object.keys(range).length > 0;

    // Tenant filter
    const tenantFilter = {
      $or: [
        { tenant_id: String(effectiveTenant) },
        { organization_id: String(effectiveTenant) },
        { tenantId: String(effectiveTenant) },
        { organizationId: String(effectiveTenant) },
        { orgId: String(effectiveTenant) },
        { 'tenant.tenant_id': String(effectiveTenant) },
      ],
    };

    const finalFilter =
      Object.keys(filter).length || Object.keys(timeFilter).length
        ? { $and: [tenantFilter, ...(Object.keys(filter).length ? [filter] : []), ...(Object.keys(timeFilter).length ? [timeFilter] : [])] }
        : tenantFilter;

    // Projection for tabular view
    const projection = {
      request_id: 1,
      // Canonical time field for filtering/sorting; keep created_at only for display fallback mapping in UI
      timestamp: 1,
      created_at: 1,
      model: 1,
      provider: 1,
      user_id: 1,
      organization_id: 1,
      tokens_in: 1,
      tokens_out: 1,
      cost_usd: 1,
      duration_ms: 1,
      status: 1,
      llm_model: 1,
      project_id: 1,
      session_id: 1,
    };

    // Initial diagnostics snapshot before heavy operations
    const baseDiag = {
      ts: new Date().toISOString(),
      effectiveTenant: String(effectiveTenant),
      page,
      limit,
      sort,
      filter: finalFilter,
      projection,
      notes: [],
    };
    lastDiagnostics = { ...baseDiag, timings: { ...timings } };
    console.log('[LLM-COSTS][DIAG][BEGIN]', safeJson(baseDiag));

    mark('parsed');

    // Build queries
    const cursor = LlmCost.find(finalFilter, projection).sort(sort).skip((page - 1) * limit).limit(limit).lean();
    const countQuery = LlmCost.countDocuments(finalFilter);

    // Diagnostics: explain plans with short timeout to avoid contributing to 504
    const wantExplain = process.env.DEBUG_LLMCOSTS_EXPLAIN === '1';
    let explainFind = null;
    let explainCount = null;
    let exampleExplains = null;

    mark('built');

    if (wantExplain && LlmCost.collection) {
      try {
        const explainAbortMs = Number(process.env.DEBUG_LLMCOSTS_EXPLAIN_TIMEOUT_MS || '600'); // keep small
        const tExplainStart = process.hrtime.bigint();

        const doExplain = async () => {
          const pipelineForCount = [{ $match: finalFilter }, { $count: 'count' }];
          const [ef, ec] = await Promise.all([
            LlmCost.collection
              .find(finalFilter, { projection })
              .sort(sort)
              .skip((page - 1) * limit)
              .limit(limit)
              .explain('executionStats'),
            LlmCost.collection.aggregate(pipelineForCount).explain('executionStats'),
          ]);
          return { ef, ec };
        };

        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('explain-timeout')), explainAbortMs));
        const { ef, ec } = await Promise.race([doExplain(), timeout]).catch((e) => {
          baseDiag.notes.push(`explain_aborted:${e.message}`);
          return { ef: null, ec: null };
        });
        explainFind = ef;
        explainCount = ec;

        // Example explains (tenant T0015) with minimal scope
        const exampleTenant = 'T0015';
        const exampleLimit = 10;
        const examplePage = 1;
        const exampleSort = { timestamp: -1 };
        const exampleProjection = projection;

        const exampleTenantFilter = {
          $or: [
            { tenant_id: exampleTenant },
            { organization_id: exampleTenant },
            { tenantId: exampleTenant },
            { organizationId: exampleTenant },
            { orgId: exampleTenant },
            { 'tenant.tenant_id': exampleTenant },
          ],
        };
        const exampleNoDateFilter = exampleTenantFilter;
        const exampleWithDateFilter = {
          $and: [
            exampleTenantFilter,
            {
              timestamp: { $gte: new Date(Date.now() - 7 * 86400000) },
            },
          ],
        };

        const doExample = async () => {
          const [exFindNoDate, exCountNoDate, exFindWithDate, exCountWithDate] = await Promise.all([
            LlmCost.collection
              .find(exampleNoDateFilter, { projection: exampleProjection })
              .sort(exampleSort)
              .skip((examplePage - 1) * exampleLimit)
              .limit(exampleLimit)
              .explain('executionStats'),
            LlmCost.collection.aggregate([{ $match: exampleNoDateFilter }, { $count: 'count' }]).explain('executionStats'),
            LlmCost.collection
              .find(exampleWithDateFilter, { projection: exampleProjection })
              .sort(exampleSort)
              .skip((examplePage - 1) * exampleLimit)
              .limit(exampleLimit)
              .explain('executionStats'),
            LlmCost.collection.aggregate([{ $match: exampleWithDateFilter }, { $count: 'count' }]).explain('executionStats'),
          ]);
          return {
            noDate: { find: summarizeExplain(exFindNoDate), count: summarizeExplain(exCountNoDate) },
            withDate: { find: summarizeExplain(exFindWithDate), count: summarizeExplain(exCountWithDate) },
          };
        };

        const timeout2 = new Promise((_, rej) => setTimeout(() => rej(new Error('example-explain-timeout')), explainAbortMs));
        exampleExplains = await Promise.race([doExample(), timeout2]).catch((e) => {
          baseDiag.notes.push(`example_explain_aborted:${e.message}`);
          return null;
        });

        const tExplainEnd = process.hrtime.bigint();
        timings.explain_ms = Number(tExplainEnd - tExplainStart) / 1e6;

        // Log truncated explain
        if (explainFind) console.log('[LLM-COSTS][EXPLAIN][FIND]', safeJson(summarizeExplain(explainFind)));
        if (explainCount) console.log('[LLM-COSTS][EXPLAIN][COUNT]', safeJson(summarizeExplain(explainCount)));
        if (exampleExplains) console.log('[LLM-COSTS][EXPLAIN][EXAMPLE]', safeJson(exampleExplains));
      } catch (e) {
        console.warn('[LLM-COSTS][EXPLAIN] capture error:', e?.message || e);
      }
    }

    // Execute queries
    const tExecStart = process.hrtime.bigint();
    const [items, total] = await Promise.all([cursor.exec(), countQuery.exec()]);
    const tExecEnd = process.hrtime.bigint();
    timings.exec_ms = Number(tExecEnd - tExecStart) / 1e6;
    mark('executed');

    // Set response headers
    try {
      res.set('x-effective-tenant', String(effectiveTenant));
      res.set('x-llm-filter', JSON.stringify(finalFilter));
      res.set('x-llm-projection', JSON.stringify(projection));
      res.set('x-llm-sort', JSON.stringify(sort));
      res.set('x-llm-page', String(page));
      res.set('x-llm-limit', String(limit));
      // No $or usage on time fields; header removed
      res.set('x-llm-timing-parsed-ms', String(Math.round(timings.parsed ?? 0)));
      res.set('x-llm-timing-built-ms', String(Math.round(timings.built ?? 0)));
      res.set('x-llm-timing-exec-ms', String(Math.round(timings.exec_ms ?? 0)));
      if (timings.explain_ms != null) res.set('x-llm-timing-explain-ms', String(Math.round(timings.explain_ms)));
      if (process.env.DEBUG_LLMCOSTS_EXPLAIN === '1') {
        if (explainFind) res.set('x-llm-explain-find', 'captured');
        if (explainCount) res.set('x-llm-explain-count', 'captured');
      }
    } catch {
      // ignore header set failures
    }

    // Update lastDiagnostics and respond
    lastDiagnostics = {
      ...baseDiag,
      timings: { ...timings },
      explain: process.env.DEBUG_LLMCOSTS_EXPLAIN === '1'
        ? { find: summarizeExplain(explainFind), count: summarizeExplain(explainCount), examples: exampleExplains || undefined }
        : undefined,
    };

    const response = {
      success: true,
      data: items,
      meta: { page, limit, total, sort: sortStr || '-timestamp' },
    };

    if (process.env.DEBUG_LLMCOSTS_EXPLAIN === '1') {
      response.meta.debug = {
        filter: finalFilter,
        sort,
        projection,

        timings,
        explain: lastDiagnostics.explain,
      };
    }

    console.log('[LLM-COSTS][DIAG][END]', safeJson({ ...lastDiagnostics, dataCount: Array.isArray(items) ? items.length : 0 }));
    return res.status(200).json(response);
  } catch (err) {
    // On errors, set partial headers and persist diagnostics
    try {
      if (lastDiagnostics) {
        lastDiagnostics.timings = { ...lastDiagnostics.timings, error_ms: Number(process.hrtime.bigint() - t0) / 1e6 };
        lastDiagnostics.error = err?.message || String(err);
      }
      setPartialHeaders(res, {
        effectiveTenant: lastDiagnostics?.effectiveTenant || '',
        timings,
        page: lastDiagnostics?.page,
        limit: lastDiagnostics?.limit,
        sort: lastDiagnostics?.sort,
        filter: lastDiagnostics?.filter,

      });
    } catch {}
    console.error('[LLM-COSTS][LIST] error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

/**
 * PUBLIC_INTERFACE
 * summarizeExplain
 * Returns a compact summary from a MongoDB explain output to highlight index usage and scanned docs.
 */
function summarizeExplain(explain) {
  try {
    if (!explain) return null;
    const stats =
      explain.executionStats ||
      explain?.stages?.find((s) => s.$cursor)?.$cursor?.executionStats ||
      explain?.stages?.find((s) => s.$cursor)?.$cursor?.allPlansExecution;
    const queryPlanner =
      explain.queryPlanner || explain?.stages?.find((s) => s.$cursor)?.$cursor?.queryPlanner || explain?.queryPlannerExtended;

    const summary = {
      nReturned: stats?.nReturned,
      totalDocsExamined: stats?.totalDocsExamined,
      totalKeysExamined: stats?.totalKeysExamined,
      executionTimeMillis: stats?.executionTimeMillis,
      stage: stats?.executionStages?.stage,
      inputStage: stats?.executionStages?.inputStage?.stage,
      usedIndexes: [],
      winningPlan: queryPlanner?.winningPlan?.stage || queryPlanner?.winningPlan?.inputStage?.stage,
    };

    const extractIndexes = (node, acc) => {
      if (!node || typeof node !== 'object') return;
      if (node.indexName) acc.add(node.indexName);
      if (node.inputStage) extractIndexes(node.inputStage, acc);
      if (Array.isArray(node.inputStages)) node.inputStages.forEach((s) => extractIndexes(s, acc));
      if (Array.isArray(node.shards)) node.shards.forEach((sh) => extractIndexes(sh?.winningPlan, acc));
      if (node.winningPlan) extractIndexes(node.winningPlan, acc);
    };
    const idx = new Set();
    extractIndexes(queryPlanner?.winningPlan, idx);
    return { ...summary, usedIndexes: Array.from(idx) };
  } catch {
    return null;
  }
}

// Helper to set partial headers even when failing early
function setPartialHeaders(res, { effectiveTenant, timings, page, limit, sort, filter }) {
  try {
    if (effectiveTenant != null) res.set('x-effective-tenant', String(effectiveTenant));
    if (filter != null) res.set('x-llm-filter', safeJson(filter));
    if (sort != null) res.set('x-llm-sort', safeJson(sort));
    if (page != null) res.set('x-llm-page', String(page));
    if (limit != null) res.set('x-llm-limit', String(limit));
    if (timings) {
      res.set('x-llm-timing-parsed-ms', String(Math.round(timings.parsed ?? 0)));
      res.set('x-llm-timing-built-ms', String(Math.round(timings.built ?? 0)));
      if (timings.exec_ms != null) res.set('x-llm-timing-exec-ms', String(Math.round(timings.exec_ms)));
      if (timings.explain_ms != null) res.set('x-llm-timing-explain-ms', String(Math.round(timings.explain_ms)));
    }
  } catch {}
}

// safe JSON short
function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{}';
  }
}

// PUBLIC_INTERFACE
function getLastLlmCostsDiagnostics() {
  /** Returns the last captured diagnostics snapshot for llm-costs listing. */
  return lastDiagnostics || null;
}

module.exports = { listLlmCosts, getLastLlmCostsDiagnostics };
