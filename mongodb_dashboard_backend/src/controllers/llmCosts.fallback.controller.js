'use strict';

const { getDb } = require('../config/db');

/* PUBLIC_INTERFACE */
/**
 * listLlmCosts
 * Handler: GET /api/llm-costs
 * Purpose: Return { success, data, meta } with pagination and diagnostics headers and correct tenant filtering.
 * Requirements implemented:
 * 1) Queries the exact deployment via env-driven mongoose connection; database forced to 'test' in config/db.js and collection 'llm-costs' (fallback also probes 'llm_costs' but prefers 'llm-costs').
 * 2) STRICT tenant filter only unless filter explicitly passed: { $or: [ { organization_id:'T0015' }, { tenant_id:'T0015' }, { org_id:'T0015' } ] }
 * 3) No ObjectId coercion for tenant; all string matching.
 * 4) Ensure path is not pointing to different collection: primary model should map to 'llm-costs'; fallback probes 'llm-costs' first then 'llm_costs'.
 * 5) Return { success, data, meta } and include headers: x-llm-filter, x-effective-tenant, x-llm-total-count (plus ancillary diagnostics).
 * 6) Supports GET /api/llm-costs?organization_id=T0015 (non-empty if data is present).
 */
async function listLlmCosts(req, res) {
  const startedAt = Date.now();

  try {
    // Resolve tenant: JWT overrides; otherwise header or query
    const jwtTenant = req?.auth?.tenantId;
    const headerOrQueryTenant =
      req.headers['x-organization-id'] ||
      req.query.organization_id ||
      req.query.tenant_id;

    let resolvedTenant = null;
    if (jwtTenant) {
      resolvedTenant = String(jwtTenant);
      if (
        headerOrQueryTenant &&
        String(headerOrQueryTenant) !== resolvedTenant
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              'Forbidden: tenant scope mismatch with JWT tenant.',
          });
      }
    } else {
      resolvedTenant = headerOrQueryTenant ? String(headerOrQueryTenant) : null;
    }

    if (!resolvedTenant) {
      return res.status(400).json({
        success: false,
        message:
          'Missing tenant (Authorization with tenant or x-organization-id / ?tenant_id / ?organization_id).',
      });
    }

    // Pagination
    const defaultLimit = process.env.DEFAULT_PAGE_LIMIT
      ? parseInt(process.env.DEFAULT_PAGE_LIMIT, 10)
      : 50;
    const maxLimit = 200;
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limitRaw = parseInt(req.query.limit || `${defaultLimit}`, 10);
    const limit =
      !Number.isFinite(limitRaw) || limitRaw <= 0 ? defaultLimit : limitRaw;
    if (limit > maxLimit) {
      return res
        .status(400)
        .json({ success: false, message: `limit must be <= ${maxLimit}` });
    }

    // Sort default by most recent timestamp
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

    // Only apply date filter if explicitly provided
    const now = new Date();
    const maxDays = process.env.MAX_DAYS_WINDOW
      ? parseInt(process.env.MAX_DAYS_WINDOW, 10)
      : 90;

    let to = null;
    let from = null;
    let applied = null;

    if (req.query.from || req.query.to) {
      to = req.query.to ? new Date(req.query.to) : now;
      from = req.query.from
        ? new Date(req.query.from)
        : new Date(to.getTime() - maxDays * 24 * 60 * 60 * 1000);
      applied = 'default';

      if (req.query.from && req.query.to) {
        const ms = Math.abs(to.getTime() - from.getTime());
        const days = ms / (24 * 60 * 60 * 1000);
        if (days > maxDays) {
          return res.status(400).json({
            success: false,
            message: `Requested window exceeds MAX_DAYS_WINDOW=${maxDays} days`,
          });
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
    }

    // Whitelist for optional explicit filters
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
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }

    // Strict tenant filter (string based)
    const tenantStr = String(resolvedTenant);
    const tenantOrs = [
      { organization_id: tenantStr },
      { tenant_id: tenantStr },
      { org_id: tenantStr },
    ];

    const ands = [{ $or: tenantOrs }];

    // add user-provided whitelisted filters
    if (Object.keys(extraFilter).length) {
      ands.push(extraFilter);
    }

    // add date on 'timestamp' ONLY when explicitly provided
    if (from && to) {
      ands.push({ timestamp: { $gte: from, $lte: to } });
    } else if (from && !to) {
      ands.push({ timestamp: { $gte: from } });
    } else if (!from && to) {
      ands.push({ timestamp: { $lte: to } });
    }

    const filter = { $and: ands };

    // Projection suitable for table
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

    // Strongly discourage caches
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    try {
      res.set('ETag', '');
    } catch {}

    // Primary: if the app provides a Mongoose model for 'llm-costs' collection
    let items = [];
    let total = 0;
    let primaryUsed = false;
    try {
      const LlmCost = req?.app?.locals?.models?.LlmCost || null;
      if (LlmCost) {
        const cursor = LlmCost.find(filter, projection)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean();
        items = await cursor;
        total = await LlmCost.countDocuments(filter);
        primaryUsed = true;
      }
    } catch (e) {
      // intentionally silent; fallback will handle
    }

    // Fallback: direct native collection access, prefer 'llm-costs' then 'llm_costs'
    let fallbackCollection = null;
    if (!primaryUsed) {
      try {
        const db = await getDb();
        const candidates = [
          process.env.LLMCOSTS_COLLECTION_NAME || 'llm-costs',
          'llm_costs',
        ].filter((v, idx, arr) => arr.indexOf(v) === idx);

        // First probe with tenant-only filter to ensure correct collection
        const tenantOnly = { $or: tenantOrs };

        for (const name of candidates) {
          try {
            const coll = db.collection(name);
            const tenantCount = await coll.countDocuments(tenantOnly).catch(() => 0);
            if (tenantCount === 0) continue;

            const t = await coll.countDocuments(filter).catch(() => 0);
            const found = await coll
              .find(filter, { projection })
              .sort(sort)
              .skip((page - 1) * limit)
              .limit(limit)
              .toArray();

            items = found || [];
            total = t || 0;
            fallbackCollection = name;
            break;
          } catch {
            continue;
          }
        }
      } catch (e) {
        // ignore; results remain as defaults
      }
    }

    // Diagnostics headers
    res.set('x-effective-tenant', tenantStr);
    res.set('x-llm-filter', JSON.stringify(filter));
    res.set('x-llm-projection', JSON.stringify(projection));
    res.set('x-llm-sort', JSON.stringify(sort));
    res.set('x-llm-page', String(page));
    res.set('x-llm-limit', String(limit));
    res.set('x-llm-total-count', String(total));
    if (from || to) {
      res.set('x-llm-window-from', from ? from.toISOString() : '');
      res.set('x-llm-window-to', to ? to.toISOString() : '');
      res.set('x-llm-window-applied', applied || 'default');
    }
    if (fallbackCollection) {
      res.set('x-llm-fallback', 'native');
      res.set('x-llm-fallback-collection', fallbackCollection);
    }

    // Response envelope
    return res.json({
      success: true,
      data: items,
      meta: {
        page,
        limit,
        total,
        sort: sortStr,
        window: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          applied: from || to ? applied || 'default' : null,
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
