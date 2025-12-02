'use strict';

const mongoose = require('mongoose');
const LlmCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 * List LLM cost records with tenant scoping, pagination, projection, and optional diagnostics.
 * - Always returns an envelope: { success, data, meta }
 * - Enforces tenant from JWT when Authorization is provided; otherwise from x-organization-id header (or aliases).
 * - filter whitelist: status, provider, llm_model, user_id, session_id, project_id, request_id
 * Diagnostics:
 * - If DEBUG_LLMCOSTS_EXPLAIN=1, capture explain() for find and count via driver and log to console.
 * - Adds response headers: x-effective-tenant, x-llm-filter, x-llm-projection, and x-llm-explain-find/count when captured.
 */
async function listLlmCosts(req, res) {
  try {
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
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
      }
      if (queryTenant && jwtTenant && String(queryTenant) !== String(jwtTenant)) {
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
      }
      effectiveTenant = jwtTenant;
    } else {
      effectiveTenant = headerTenant || queryTenant;
    }

    if (!effectiveTenant) {
      return res.status(400).json({ success: false, message: 'Missing tenant: provide Authorization with tenant or x-organization-id header' });
    }

    // Pagination and sort
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const maxLimit = 200;
    const defaultLimit = 50;
    const limit = Math.min(Math.max(parseInt(req.query.limit || String(defaultLimit), 10) || defaultLimit, 1), maxLimit);
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
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }
    const filter = Object.fromEntries(Object.entries(rawFilter).filter(([k]) => allowed.includes(k)));

    // Time range filter applied on timestamp or created_at
    const range = {};
    if (req.query.from) {
      const d = new Date(req.query.from);
      if (!isNaN(d.getTime())) range.$gte = d;
    }
    if (req.query.to) {
      const d = new Date(req.query.to);
      if (!isNaN(d.getTime())) range.$lte = d;
    }
    const timeFilter = Object.keys(range).length
      ? { $or: [{ timestamp: range }, { created_at: range }] }
      : {};

    // Tenant filter: match any of known fields for tenant
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

    const finalFilter = Object.keys(filter).length || Object.keys(timeFilter).length
      ? { $and: [tenantFilter, ...(Object.keys(filter).length ? [filter] : []), ...(Object.keys(timeFilter).length ? [timeFilter] : [])] }
      : tenantFilter;

    // Projection for tabular view
    const projection = {
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
      llm_model: 1, // align with filter whitelist
      project_id: 1,
      session_id: 1,
    };

    // Build mongoose queries
    const cursor = LlmCost.find(finalFilter, projection)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const countQuery = LlmCost.countDocuments(finalFilter);

    // Diagnostics: explain plans
    const wantExplain = process.env.DEBUG_LLMCOSTS_EXPLAIN === '1';
    let explainFind = null;
    let explainCount = null;

    if (wantExplain && LlmCost.collection) {
      try {
        // Use native driver for more complete explain
        const pipelineForCount = [{ $match: finalFilter }, { $count: 'count' }];
        explainFind = await LlmCost.collection
          .find(finalFilter, { projection })
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .explain('executionStats');

        explainCount = await LlmCost.collection.aggregate(pipelineForCount).explain('executionStats');

        // Log truncated explain to avoid flooding logs
        console.log('[LLM-COSTS][EXPLAIN][FIND]', JSON.stringify(explainFind).slice(0, 20000));
        console.log('[LLM-COSTS][EXPLAIN][COUNT]', JSON.stringify(explainCount).slice(0, 20000));
      } catch (e) {
        console.warn('[LLM-COSTS][EXPLAIN] Failed to capture explain()', e?.message || e);
      }
    }

    const [items, total] = await Promise.all([cursor.exec(), countQuery.exec()]);

    try {
      res.set('x-effective-tenant', String(effectiveTenant));
      res.set('x-llm-filter', JSON.stringify(finalFilter));
      res.set('x-llm-projection', JSON.stringify(projection));
      if (wantExplain) {
        if (explainFind) res.set('x-llm-explain-find', 'captured');
        if (explainCount) res.set('x-llm-explain-count', 'captured');
      }
    } catch {}

    return res.status(200).json({
      success: true,
      data: items,
      meta: { page, limit, total, sort: sortStr || '-timestamp' },
    });
  } catch (err) {
    console.error('[LLM-COSTS][LIST] error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { listLlmCosts };
