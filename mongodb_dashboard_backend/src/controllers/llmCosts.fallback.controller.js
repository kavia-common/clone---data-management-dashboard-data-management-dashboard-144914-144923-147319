'use strict';

const { getDb } = require('../config/db');

/*
  PUBLIC_INTERFACE
  listLlmCosts
  Handler: GET /api/llm-costs
  Implements:
  - Exact tenant filter (string match) across organization_id, tenant_id, org_id.
  - No hidden filters (date/model/user/project) unless provided via query params.
  - Uses the 'llm-costs' collection (or explicit env override) and prevents ObjectId coercion.
  - Always returns envelope { success, data, meta } and adds diagnostics headers.
*/
async function listLlmCosts(req, res) {
  const t0 = Date.now();

  try {
    // Tenant resolution with strict enforcement when JWT is present.
    const jwtTenant = req?.auth?.tenantId;
    const headerOrQueryTenant =
      req.headers['x-organization-id'] ||
      req.query.organization_id ||
      req.query.tenant_id;

    let resolvedTenant = null;
    if (jwtTenant) {
      resolvedTenant = String(jwtTenant);
      if (headerOrQueryTenant && String(headerOrQueryTenant) !== resolvedTenant) {
        // Disable caching for error as well
        res.set('Cache-Control', 'no-store');
        res.removeHeader('ETag');
        return res.status(403).json({
          success: false,
          data: [],
          meta: { page: 1, limit: 0, total: 0 },
          message: 'Forbidden: tenant scope mismatch with JWT tenant',
        });
      }
    } else {
      resolvedTenant = headerOrQueryTenant ? String(headerOrQueryTenant) : null;
    }

    if (!resolvedTenant) {
      res.set('Cache-Control', 'no-store');
      res.removeHeader('ETag');
      return res.status(400).json({
        success: false,
        data: [],
        meta: { page: 1, limit: 0, total: 0 },
        message:
          'Missing tenant. Provide Authorization with tenant, x-organization-id header, or ?tenant_id / ?organization_id query',
      });
    }

    // Pagination (envelope is always used for this endpoint)
    const defaultLimit = process.env.DEFAULT_PAGE_LIMIT
      ? parseInt(process.env.DEFAULT_PAGE_LIMIT, 10)
      : 50;
    const maxLimit = 200;
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limitRaw = parseInt(req.query.limit || `${defaultLimit}`, 10);
    const limit =
      !Number.isFinite(limitRaw) || limitRaw <= 0 ? defaultLimit : limitRaw;
    if (limit > maxLimit) {
      res.set('Cache-Control', 'no-store');
      res.removeHeader('ETag');
      return res
        .status(400)
        .json({ success: false, data: [], meta: { page, limit: 0, total: 0 }, message: `limit must be <= ${maxLimit}` });
    }

    // Sort: respect provided sort; default to -timestamp. No hidden sort overrides.
    const sortStr = (req.query.sort || '-timestamp').trim();
    const sort = {};
    if (sortStr) {
      sortStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => {
          if (s.startsWith('-')) sort[s.substring(1)] = -1;
          else sort[s] = 1;
        });
    }

    // Optional date window only when provided; apply to 'timestamp' only.
    const maxDays = process.env.MAX_DAYS_WINDOW
      ? parseInt(process.env.MAX_DAYS_WINDOW, 10)
      : 90;
    const now = new Date();
    let from = null;
    let to = null;
    let windowApplied = null;

    if (req.query.from || req.query.to) {
      to = req.query.to ? new Date(req.query.to) : now;
      from = req.query.from
        ? new Date(req.query.from)
        : new Date(to.getTime() - maxDays * 24 * 60 * 60 * 1000);
      windowApplied = 'default';

      if (req.query.from && req.query.to) {
        const ms = Math.abs(to - from);
        if (ms / (24 * 60 * 60 * 1000) > maxDays) {
          res.set('Cache-Control', 'no-store');
          res.removeHeader('ETag');
          return res.status(400).json({
            success: false,
            data: [],
            meta: { page, limit, total: 0 },
            message: `Requested window exceeds MAX_DAYS_WINDOW=${maxDays} days`,
          });
        }
        windowApplied = null;
      } else if (req.query.from && !req.query.to) {
        const maxTo = new Date(from.getTime() + maxDays * 24 * 60 * 60 * 1000);
        if (to > maxTo) windowApplied = 'clamped_to';
      } else if (!req.query.from && req.query.to) {
        const maxFrom = new Date(to.getTime() - maxDays * 24 * 60 * 60 * 1000);
        if (from < maxFrom) windowApplied = 'clamped_from';
      }
    }

    // Optional extra filters (whitelisted only)
    const allowed = [
      'status',
      'provider',
      'llm_model',
      'user_id',
      'session_id',
      'project_id',
      'request_id',
    ];
    let extraFilter = {};
    if (req.query.filter) {
      try {
        const parsed = JSON.parse(req.query.filter);
        extraFilter = Object.fromEntries(
          Object.entries(parsed).filter(([k]) => allowed.includes(k))
        );
      } catch {
        res.set('Cache-Control', 'no-store');
        res.removeHeader('ETag');
        return res
          .status(400)
          .json({ success: false, data: [], meta: { page, limit, total: 0 }, message: 'Invalid filter JSON' });
      }
    }

    // Exact tenant filter (string match only, no ObjectId coercion)
    const tenantStr = String(resolvedTenant);
    const tenantOr = [{ organization_id: tenantStr }, { tenant_id: tenantStr }, { org_id: tenantStr }];
    const ands = [{ $or: tenantOr }];

    // Merge optional filters only if provided
    if (Object.keys(extraFilter).length) {
      ands.push(extraFilter);
    }
    if (from && to) {
      ands.push({ timestamp: { $gte: from, $lte: to } });
    } else if (from && !to) {
      ands.push({ timestamp: { $gte: from } });
    } else if (!from && to) {
      ands.push({ timestamp: { $lte: to } });
    }

    const filter = { $and: ands };

    // Projection for tabular response
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
      total_cost: 1,
      currency: 1,
      duration_ms: 1,
      status: 1,
      details: 1,
    };

    // Disable caching for this endpoint
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    try {
      res.removeHeader('ETag');
    } catch (_) {}

    // Try Mongoose model first if registered (must map to 'llm-costs' via model config)
    let items = [];
    let total = 0;
    let primaryUsed = false;
    try {
      const LlmCost = req?.app?.locals?.models?.LlmCost || null;
      if (LlmCost) {
        items = await LlmCost.find(filter, projection)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean();
        total = await LlmCost.countDocuments(filter);
        primaryUsed = true;
      }
    } catch (_) {
      // Fall through to native
    }

    // Fallback: Native collection, prioritizing 'llm-costs'
    let fallbackCollection = null;
    if (!primaryUsed) {
      try {
        const db = await getDb();
        const explicit =
          (process.env.LLMCOSTS_COLLECTION_NAME ||
            process.env.LLM_COSTS_COLLECTION_NAME ||
            '').trim();
        const candidates = (explicit ? [explicit] : ['llm-costs']).filter(
          (v, i, a) => v && a.indexOf(v) === i
        );

        const tenantOnly = { $or: tenantOr };

        for (const name of candidates) {
          try {
            const coll = db.collection(name);
            const tenantCount = await coll
              .countDocuments(tenantOnly)
              .catch(() => 0);
            if (!tenantCount) continue;

            total = await coll.countDocuments(filter).catch(() => 0);
            items = await coll
              .find(filter, { projection })
              .sort(sort)
              .skip((page - 1) * limit)
              .limit(limit)
              .toArray();

            fallbackCollection = name;
            break;
          } catch (_) {
            // try next
          }
        }
      } catch (_) {
        // ignore: empty results will be returned
      }
    }

    // Diagnostics headers (required)
    res.set('x-effective-tenant', tenantStr);
    res.set('x-llm-filter', JSON.stringify(filter));
    res.set('x-llm-total-count', String(total));

    // Optional extra diagnostics for parity with docs
    res.set('x-llm-projection', JSON.stringify(projection));
    res.set('x-llm-sort', JSON.stringify(sort));
    res.set('x-llm-page', String(page));
    res.set('x-llm-limit', String(limit));
    if (from || to) {
      res.set('x-llm-window-from', from ? from.toISOString() : '');
      res.set('x-llm-window-to', to ? to.toISOString() : '');
      res.set('x-llm-window-applied', windowApplied || 'default');
    } else {
      res.set('x-llm-window-from', '');
      res.set('x-llm-window-to', '');
      res.set('x-llm-window-applied', '');
    }
    if (fallbackCollection) {
      res.set('x-llm-fallback', 'native');
      res.set('x-llm-fallback-collection', fallbackCollection);
    }

    // Envelope response
    return res.json({
      success: true,
      data: Array.isArray(items) && items.length ? items : [],
      meta: {
        page,
        limit,
        total: Number.isFinite(total) ? total : 0,
        sort: sortStr,
        window: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          applied: from || to ? windowApplied || 'default' : null,
        },
        diagnostics: { headers: req.headers },
        timings: { parsed_ms: Date.now() - t0 },
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/llm-costs error', err);
    res.set('Cache-Control', 'no-store');
    res.removeHeader('ETag');
    return res
      .status(500)
      .json({ success: false, data: [], meta: { page: 1, limit: 0, total: 0 }, message: 'Internal server error' });
  }
}

module.exports = { listLlmCosts };
