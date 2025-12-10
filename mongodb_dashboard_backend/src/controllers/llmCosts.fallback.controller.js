'use strict';

const { getDb } = require('../config/db');

// PUBLIC_INTERFACE
async function listLlmCosts(req, res) {
  /**
   * Handler: GET /api/llm-costs
   * Primary path uses Mongoose model if available via req.app.locals.models?.LlmCost; if primary returns zero,
   * performs a safe, read-only fallback using native driver probing collections:
   *   - process.env.LLMCOSTS_COLLECTION_NAME (default 'llm-costs')
   *   - 'llm_costs'
   * Tenant matching checks across organization_id/tenant_id/orgId/tenantId/organizationId and nested tenant.tenant_id.
   * Returns paginated envelope with diagnostics headers.
   */
  const startParsed = Date.now();

  try {
    // Resolve tenantId: prioritize JWT-derived req.auth.tenantId (if present), else header, then query.
    const jwtTenant = req?.auth?.tenantId;
    const headerTenant =
      req.headers['x-organization-id'] ||
      req.headers['x-tenant-id'] ||
      req.headers['x-tenant'] ||
      req.query.organization_id ||
      req.query.tenant_id;

    let resolvedTenant = null;
    if (jwtTenant) {
      resolvedTenant = String(jwtTenant);
      if (headerTenant && String(headerTenant) !== resolvedTenant) {
        // Log and enforce 403 when a conflicting tenant is provided alongside JWT tenant.
        if (process.env.NODE_ENV !== 'production') {
          try {
            console.info('[llm-costs] JWT tenant mismatch', { jwtTenant, headerTenant });
          } catch {}
        }
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch with JWT tenant.' });
      }
    } else {
      resolvedTenant = headerTenant ? String(headerTenant) : null;
    }

    if (!resolvedTenant) {
      if (process.env.NODE_ENV !== 'production') {
        try {
          console.info('[llm-costs] missing tenant; require header x-organization-id or ?tenant_id/?organization_id');
        } catch {}
      }
      return res.status(400).json({ success: false, message: 'Missing tenant (Authorization with tenant or x-organization-id / ?tenant_id / ?organization_id).' });
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
    if (process.env.NODE_ENV !== 'production') {
      try {
        console.info('[llm-costs] paging', { page, limit, defaultLimit });
      } catch {}
    }

    // Sort parsing: default '-timestamp' -> { timestamp: -1 }, supports 'field' or '-field'
    const sortStr = (req.query.sort || '-timestamp').trim();
    let sort = {};
    if (sortStr) {
      sortStr.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
        if (s.startsWith('-')) {
          sort[s.substring(1)] = -1;
        } else {
          sort[s] = 1;
        }
      });
    }

    // Date window handling on canonical 'timestamp'
    // CHANGE: Only apply a date window if from/to are provided. If both are absent, do NOT filter by time.
    const now = new Date();
    const maxDays = process.env.MAX_DAYS_WINDOW ? parseInt(process.env.MAX_DAYS_WINDOW, 10) : 90;

    let to = null;
    let from = null;
    let applied = null;

    if (req.query.from || req.query.to) {
      to = req.query.to ? new Date(req.query.to) : now;
      from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - maxDays * 24 * 60 * 60 * 1000);
      applied = 'default';

      if (req.query.from && req.query.to) {
        const ms = Math.abs(to.getTime() - from.getTime());
        const days = ms / (24 * 60 * 60 * 1000);
        if (days > maxDays) {
          return res.status(400).json({ success: false, message: `Requested window exceeds MAX_DAYS_WINDOW=${maxDays} days` });
        }
        applied = null;
      } else if (req.query.from && !req.query.to) {
        // clamp to within maxDays forward
        const maxTo = new Date(from.getTime() + maxDays * 24 * 60 * 60 * 1000);
        if (to > maxTo) { applied = 'clamped_to'; }
      } else if (!req.query.from && req.query.to) {
        const maxFrom = new Date(to.getTime() - maxDays * 24 * 60 * 60 * 1000);
        if (from < maxFrom) { applied = 'clamped_from'; }
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      try {
        console.info('[llm-costs] effective window', {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          applied,
          maxDays
        });
      } catch {}
    }

    // Whitelist filter fields
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

    // Build tenant scoped filter
    // Normalize tenant to string to avoid ObjectId/number mismatches
    const tenantStr = String(resolvedTenant);

    const tenantOrs = [
      { organization_id: tenantStr },
      { tenant_id: tenantStr },
      { orgId: tenantStr },
      { tenantId: tenantStr },
      { organizationId: tenantStr },
      { 'tenant.tenant_id': tenantStr },
      // sometimes nested as details.tenant_id or metadata.tenant_id
      { 'details.tenant_id': tenantStr },
      { 'metadata.tenant_id': tenantStr },
    ];

    const ands = [
      { $or: tenantOrs },
      Object.keys(extraFilter).length ? extraFilter : null
    ].filter(Boolean);

    // Only add timestamp constraint when a window is provided
    if (from && to) {
      ands.push({ timestamp: { $gte: from, $lte: to } });
    } else if (from && !to) {
      ands.push({ timestamp: { $gte: from } });
    } else if (!from && to) {
      ands.push({ timestamp: { $lte: to } });
    }

    const filter = { $and: ands };

    if (process.env.NODE_ENV !== 'production') {
      try {
        console.info('[llm-costs] effective filter', {
          tenant: resolvedTenant,
          filter,
          sort,
          page,
          limit,
        });
      } catch {}
    }

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
      details: 1
    };

    // Primary (Mongoose) path: if LlmCost model is registered in app locals
    let primaryItems = [];
    let primaryTotal = 0;
    let primaryTookMs = 0;
    try {
      const LlmCost = req?.app?.locals?.models?.LlmCost || null;
      if (LlmCost) {
        // Diagnostic: check if any document exists for the tenant ignoring timestamp to verify collection binding
        try {
          const tenantProbe = await LlmCost.findOne({
            $or: [
              { tenant_id: tenantStr },
              { organization_id: tenantStr },
              { organizationId: tenantStr },
              { tenantId: tenantStr },
              { orgId: tenantStr },
              { 'tenant.tenant_id': tenantStr },
              { 'details.tenant_id': tenantStr },
              { 'metadata.tenant_id': tenantStr },
            ],
          }).select({ _id: 1, tenant_id: 1, organization_id: 1, organizationId: 1 }).lean();
          if (tenantProbe) {
            try { res.set('x-llm-primary-sample', JSON.stringify(tenantProbe)); } catch {}
          }
        } catch {}

        const startExec = Date.now();
        const q = LlmCost.find(filter, projection).sort(sort).skip((page - 1) * limit).limit(limit).lean();
        primaryItems = await q;
        primaryTotal = await LlmCost.countDocuments(filter);
        primaryTookMs = Date.now() - startExec;
      }
    } catch (e) {
      // log but continue to fallback
      // eslint-disable-next-line no-console
      console.warn('[llm-costs] Primary Mongoose path errored, will try fallback:', e?.message || e);
    }

    // If primary had results, return standard envelope
    if (primaryTotal > 0) {
      // No cache: avoid caching empty payloads or tenant-scoped data
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');

      res.set('x-effective-tenant', tenantStr);
      res.set('x-llm-filter', JSON.stringify(filter));
      res.set('x-llm-projection', JSON.stringify(projection));
      res.set('x-llm-sort', JSON.stringify(sort));
      res.set('x-llm-page', String(page));
      res.set('x-llm-limit', String(limit));
      res.set('x-llm-timing-parsed-ms', String(Date.now() - startParsed));
      res.set('x-llm-timing-built-ms', '0');
      res.set('x-llm-timing-exec-ms', String(primaryTookMs));
      if (from || to) {
        res.set('x-llm-window-from', from ? from.toISOString() : '');
        res.set('x-llm-window-to', to ? to.toISOString() : '');
        res.set('x-llm-window-applied', applied || 'default');
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
            applied: applied || 'default'
          },
          diagnostics: { headers: req.headers }
        }
      });
    }

    // Fallback: probe native driver on llm-costs and llm_costs
    let fallbackItems = [];
    let fallbackTotal = 0;
    let fallbackCollection = null;
    let fallbackFoundSample = null;
    try {
      const db = await getDb();
      const candidates = [
        process.env.LLMCOSTS_COLLECTION_NAME || 'llm-costs',
        'llm_costs'
      ].filter((v, idx, arr) => arr.indexOf(v) === idx);

      // detect tenant data presence ignoring window
      const tenantOnly = {
        $or: [
          { organization_id: tenantStr },
          { tenant_id: tenantStr },
          { orgId: tenantStr },
          { tenantId: tenantStr },
          { organizationId: tenantStr },
          { 'tenant.tenant_id': tenantStr },
          { 'details.tenant_id': tenantStr },
          { 'metadata.tenant_id': tenantStr },
        ]
      };

      for (const name of candidates) {
        try {
          const coll = db.collection(name);

          // Direct sample probe for diagnostics (without any time filter)
          fallbackFoundSample = await coll.findOne(tenantOnly, { projection: { _id: 1, tenant_id: 1, organization_id: 1, organizationId: 1, timestamp: 1 } }).catch(() => null);

          const tenantCount = await coll.countDocuments(tenantOnly).catch(() => 0);
          if (tenantCount === 0) continue;

          const t = await coll.countDocuments(filter).catch(() => 0);
          const items = await coll.find(filter, { projection }).sort(sort).skip((page - 1) * limit).limit(limit).toArray();
          fallbackItems = items || [];
          fallbackTotal = t || 0;
          fallbackCollection = name;
          break;
        } catch {
          // try next
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
        tenant: tenantStr,
        collection: fallbackCollection
      });

      // No cache
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');

      res.set('x-llm-fallback', 'native');
      res.set('x-llm-fallback-collection', fallbackCollection);
      if (fallbackFoundSample && fallbackFoundSample._id) {
        try { res.set('x-llm-fallback-sample', JSON.stringify(fallbackFoundSample)); } catch {}
      }
      res.set('x-llm-fallback-warning', 'Primary path returned 0; using native probe. Configure LLMCOSTS_COLLECTION_NAME accordingly.');

      res.set('x-effective-tenant', tenantStr);
      res.set('x-llm-filter', JSON.stringify(filter));
      res.set('x-llm-projection', JSON.stringify(projection));
      res.set('x-llm-sort', JSON.stringify(sort));
      res.set('x-llm-page', String(page));
      res.set('x-llm-limit', String(limit));
      res.set('x-llm-timing-parsed-ms', String(Date.now() - startParsed));
      res.set('x-llm-timing-built-ms', '0');
      if (from || to) {
        res.set('x-llm-window-from', from ? from.toISOString() : '');
        res.set('x-llm-window-to', to ? to.toISOString() : '');
        res.set('x-llm-window-applied', applied || 'default');
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
            applied: applied || 'default'
          },
          diagnostics: { headers: req.headers },
          debug: {
            fallback: true,
            collection: fallbackCollection
          }
        }
      });
    }

    // No results anywhere
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');

    res.set('x-effective-tenant', tenantStr);
    res.set('x-llm-filter', JSON.stringify(filter));
    res.set('x-llm-projection', JSON.stringify(projection));
    res.set('x-llm-sort', JSON.stringify(sort));
    res.set('x-llm-page', String(page));
    res.set('x-llm-limit', String(limit));
    res.set('x-llm-timing-parsed-ms', String(Date.now() - startParsed));
    res.set('x-llm-timing-built-ms', '0');
    if (from || to) {
      res.set('x-llm-window-from', from ? from.toISOString() : '');
      res.set('x-llm-window-to', to ? to.toISOString() : '');
      res.set('x-llm-window-applied', applied || 'default');
    }

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
          applied: applied || 'default'
        },
        diagnostics: { headers: req.headers }
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/llm-costs error', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { listLlmCosts };
