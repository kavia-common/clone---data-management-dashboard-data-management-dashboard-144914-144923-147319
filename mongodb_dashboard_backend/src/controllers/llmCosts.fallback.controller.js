'use strict';

const { getDb } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 * Handler for GET /api/llm-costs that returns a paginated tabular list of LLM cost documents.
 * Strategy:
 * 1) Try primary Mongoose model (if registered) with enforced tenant filter and projection.
 * 2) If empty, fallback to native driver with underscore collection precedence (llm_costs),
 *    supporting env overrides LLMCOSTS_COLLECTION_NAME or LLM_COSTS_COLLECTION.
 * Behavior:
 * - Always enforces tenant scope from Authorization JWT (req.auth.tenantId) if present, otherwise from
 *   x-organization-id or query aliases (?organization_id/?tenant_id).
 * - Builds an explicit $match including case-insensitive tenant fallbacks and timestamp window.
 * - Applies pagination ($skip/$limit) AFTER $match to ensure correct paging.
 * - Adds diagnostics headers:
 *    X-LLM-COSTS-Collection: effective collection used
 *    X-LLM-COSTS-Pipeline: JSON of { match, sort, page, limit, projection }
 *    X-LLM-COSTS-Matched: total matched documents (before pagination)
 *    X-LLM-COSTS-Reason: present when result is empty, with terse reason
 */
async function listLlmCosts(req, res) {
  const startParsed = Date.now();

  try {
    // Resolve tenant
    const jwtTenant = req?.auth?.tenantId;
    const headerTenant = req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id;

    let resolvedTenant = null;
    if (jwtTenant) {
      resolvedTenant = String(jwtTenant);
      if (headerTenant && String(headerTenant) !== resolvedTenant) {
        return res
          .status(403)
          .json({ success: false, message: 'Forbidden: tenant scope mismatch with JWT tenant.' });
      }
    } else {
      resolvedTenant = headerTenant ? String(headerTenant) : null;
    }

    if (!resolvedTenant) {
      return res.status(400).json({
        success: false,
        message:
          'Missing tenant (Authorization with tenant or x-organization-id / ?tenant_id / ?organization_id).',
      });
    }

    // Pagination and sorting
    const defaultLimit = process.env.DEFAULT_PAGE_LIMIT ? parseInt(process.env.DEFAULT_PAGE_LIMIT, 10) : 50;
    const maxLimit = 200;
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limitRaw = parseInt(req.query.limit || `${defaultLimit}`, 10);
    const limit = !Number.isFinite(limitRaw) || limitRaw <= 0 ? defaultLimit : limitRaw;
    if (limit > maxLimit) {
      return res.status(400).json({ success: false, message: `limit must be <= ${maxLimit}` });
    }

    // Sort parsing: default '-timestamp'
    const sortStr = (req.query.sort || '-timestamp').trim();
    let sort = {};
    if (sortStr) {
      sortStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => {
          if (s.startsWith('-')) {
            sort[s.substring(1)] = -1;
          } else {
            sort[s] = 1;
          }
        });
    }

    // Date window handling on 'timestamp'
    const now = new Date();
    const maxDays = process.env.MAX_DAYS_WINDOW ? parseInt(process.env.MAX_DAYS_WINDOW, 10) : 90;
    const to = req.query.to ? new Date(req.query.to) : now;
    const from = req.query.from ? new Date(req.query.from) : new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);

    let applied = 'default';
    if (req.query.from && req.query.to) {
      const ms = Math.abs(to.getTime() - from.getTime());
      const days = ms / (24 * 60 * 60 * 1000);
      if (days > maxDays) {
        return res
          .status(400)
          .json({ success: false, message: `Requested window exceeds MAX_DAYS_WINDOW=${maxDays} days` });
      }
      applied = null;
    } else if (req.query.from && !req.query.to) {
      const maxTo = new Date(from.getTime() + maxDays * 24 * 60 * 60 * 1000);
      if (to > maxTo) {
        applied = 'clamped_to';
      }
    } else if (!req.query.from && req.query.to) {
      const maxFrom = new Date(to.getTime() - maxDays * 24 * 60 * 60 * 1000);
      if (from < maxFrom) {
        applied = 'clamped_from';
      }
    }

    // Whitelist filter
    const allowed = ['status', 'provider', 'llm_model', 'user_id', 'session_id', 'project_id', 'request_id'];
    let extraFilter = {};
    if (req.query.filter) {
      try {
        const parsed = JSON.parse(req.query.filter);
        extraFilter = Object.fromEntries(Object.entries(parsed).filter(([k]) => allowed.includes(k)));
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }

    // Build $match including case-insensitive fallback
    const tenantRegex = { $regex: `^${resolvedTenant}$`, $options: 'i' };
    const match = {
      $and: [
        {
          $or: [
            { organization_id: resolvedTenant },
            { tenant_id: resolvedTenant },
            { orgId: resolvedTenant },
            { tenantId: resolvedTenant },
            { organizationId: resolvedTenant },
            { 'tenant.tenant_id': resolvedTenant },
            { organization_id: tenantRegex },
            { tenant_id: tenantRegex },
          ],
        },
        { timestamp: { $gte: from, $lte: to } },
        Object.keys(extraFilter).length ? extraFilter : null,
      ].filter(Boolean),
    };

    // Projection: lean tabular set
    const projection = {
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
      prompt: 1,
      completion: 1,
      cost_usd: 1,
      total_cost: 1,
      currency: 1,
      duration_ms: 1,
      status: 1,
      details: 1,
    };

    // Primary (Mongoose) path
    let primaryItems = [];
    let primaryTotal = 0;
    let primaryTookMs = 0;
    let primaryCollectionName = 'llm_costs';
    try {
      const LlmCost = req?.app?.locals?.models?.LlmCost || null;
      if (LlmCost) {
        try {
          primaryCollectionName = LlmCost.collection?.name || 'llm_costs';
        } catch {}
        const startExec = Date.now();
        const q = LlmCost.find(match, projection)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean();
        primaryItems = await q;
        primaryTotal = await LlmCost.countDocuments(match);
        primaryTookMs = Date.now() - startExec;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[llm-costs] Primary Mongoose path errored, will try fallback:', e?.message || e);
    }

    if (primaryTotal > 0) {
      res.set('x-effective-tenant', resolvedTenant);
      res.set('x-llm-filter', JSON.stringify(match));
      res.set('x-llm-projection', JSON.stringify(projection));
      res.set('x-llm-sort', JSON.stringify(sort));
      res.set('x-llm-page', String(page));
      res.set('x-llm-limit', String(limit));
      res.set('x-llm-timing-parsed-ms', String(Date.now() - startParsed));
      res.set('x-llm-timing-exec-ms', String(primaryTookMs));
      res.set('x-llm-window-from', from.toISOString());
      res.set('x-llm-window-to', to.toISOString());
      res.set('x-llm-window-applied', applied || 'default');

      // Required diagnostics
      res.set('X-LLM-COSTS-Collection', primaryCollectionName);
      res.set('X-LLM-COSTS-Pipeline', JSON.stringify({ match, sort, page, limit, projection }));
      res.set('X-LLM-COSTS-Matched', String(primaryTotal));
      res.set('X-LLM-COSTS-Reason', 'Safe parsing for currency strings is enabled in aggregation endpoints.');

      if (String(resolvedTenant || '') === 'b2c') {
        try {
          res.set('x-llm-debug-sample', JSON.stringify(primaryItems?.[0] || null));
        } catch {}
      }

      return res.json({
        success: true,
        data: primaryItems,
        meta: {
          page,
          limit,
          total: primaryTotal,
          sort: sortStr,
          window: {
            from: from.toISOString(),
            to: to.toISOString(),
            applied: applied || 'default',
          },
          diagnostics: { headers: req.headers },
        },
      });
    }

    // Fallback native driver path: underscore 'llm_costs' first, then env override
    let fallbackItems = [];
    let fallbackTotal = 0;
    let fallbackCollection = null;
    try {
      const db = await getDb();
      const envName = (process.env.LLMCOSTS_COLLECTION_NAME || process.env.LLM_COSTS_COLLECTION || '').trim();
      const candidates = ['llm_costs', envName || 'llm_costs'].filter((v, i, a) => v && a.indexOf(v) === i);

      // Count tenant-only presence (case-insensitive fallback included)
      const tenantOnly = {
        $or: [
          { organization_id: resolvedTenant },
          { tenant_id: resolvedTenant },
          { orgId: resolvedTenant },
          { tenantId: resolvedTenant },
          { organizationId: resolvedTenant },
          { 'tenant.tenant_id': resolvedTenant },
          { organization_id: { $regex: `^${resolvedTenant}$`, $options: 'i' } },
          { tenant_id: { $regex: `^${resolvedTenant}$`, $options: 'i' } },
        ],
      };

      for (const name of candidates) {
        try {
          const coll = db.collection(name);

          // Pre-match count before pagination
          const preMatchCount = await coll.countDocuments({ $and: match.$and.filter(Boolean) }).catch(() => 0);
          const tenantCount = await coll.countDocuments(tenantOnly).catch(() => 0);

          const items = await coll
            .find(match, { projection })
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray();

          res.set('x-llm-probed-collection', name);
          res.set('x-llm-tenant-matched', String(tenantCount));
          res.set('x-llm-total-matched', String(preMatchCount));

          fallbackItems = items || [];
          fallbackTotal = preMatchCount || 0;
          fallbackCollection = name;
          break;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[llm-costs] Probe collection failed:', name, e?.message || e);
          continue;
        }
      }
    } catch (ferr) {
      // eslint-disable-next-line no-console
      console.warn('[llm-costs] Fallback probe failed:', ferr?.message || ferr);
    }

    if (fallbackCollection) {
      // eslint-disable-next-line no-console
      console.warn('[llm-costs] Primary path returned zero but fallback found data', {
        tenant: resolvedTenant,
        collection: fallbackCollection,
      });

      res.set('x-llm-fallback', 'native');
      res.set('x-llm-fallback-collection', fallbackCollection);
      res.set(
        'x-llm-fallback-warning',
        'Primary path returned 0; using native probe. Configure LLMCOSTS_COLLECTION_NAME accordingly.'
      );

      res.set('x-effective-tenant', resolvedTenant);
      res.set('x-llm-filter', JSON.stringify(match));
      res.set('x-llm-projection', JSON.stringify(projection));
      res.set('x-llm-sort', JSON.stringify(sort));
      res.set('x-llm-page', String(page));
      res.set('x-llm-limit', String(limit));
      res.set('x-llm-timing-parsed-ms', String(Date.now() - startParsed));
      res.set('x-llm-window-from', from.toISOString());
      res.set('x-llm-window-to', to.toISOString());
      res.set('x-llm-window-applied', applied || 'default');

      // Required diagnostics
      res.set('X-LLM-COSTS-Collection', fallbackCollection);
      res.set('X-LLM-COSTS-Pipeline', JSON.stringify({ match, sort, page, limit, projection }));
      res.set('X-LLM-COSTS-Matched', String(fallbackTotal));
      res.set('X-LLM-COSTS-Reason', 'Safe parsing for currency strings is enabled in aggregation endpoints.');

      if (String(resolvedTenant || '') === 'b2c') {
        try {
          res.set('x-llm-debug-sample', JSON.stringify(fallbackItems?.[0] || null));
        } catch {}
      }

      return res.json({
        success: true,
        data: fallbackItems,
        meta: {
          page,
          limit,
          total: fallbackTotal,
          sort: sortStr,
          window: {
            from: from.toISOString(),
            to: to.toISOString(),
            applied: applied || 'default',
          },
          diagnostics: { headers: req.headers },
          debug: {
            fallback: true,
            collection: fallbackCollection,
          },
        },
      });
    }

    // No results
    const effFallback = (process.env.LLMCOSTS_COLLECTION_NAME || process.env.LLM_COSTS_COLLECTION || '').trim() || 'llm_costs';

    res.set('x-effective-tenant', resolvedTenant);
    res.set('x-llm-filter', JSON.stringify(match));
    res.set('x-llm-projection', JSON.stringify(projection));
    res.set('x-llm-sort', JSON.stringify(sort));
    res.set('x-llm-page', String(page));
    res.set('x-llm-limit', String(limit));
    res.set('x-llm-timing-parsed-ms', String(Date.now() - startParsed));
    res.set('x-llm-window-from', from.toISOString());
    res.set('x-llm-window-to', to.toISOString());
    res.set('x-llm-window-applied', applied || 'default');
    res.set('x-llm-fallback-collection', effFallback);

    // Required diagnostics when empty
    res.set('X-LLM-COSTS-Collection', effFallback);
    res.set('X-LLM-COSTS-Pipeline', JSON.stringify({ match, sort, page, limit, projection }));
    res.set('X-LLM-COSTS-Matched', '0');
    res.set('X-LLM-COSTS-Reason', 'No documents matched tenant/time window; safe parsing applies on aggregation endpoints.');

    return res.json({
      success: true,
      data: [],
      meta: {
        page,
        limit,
        total: 0,
        sort: sortStr,
        window: {
          from: from.toISOString(),
          to: to.toISOString(),
          applied: applied || 'default',
        },
        diagnostics: { headers: req.headers },
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/llm-costs error', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { listLlmCosts };
