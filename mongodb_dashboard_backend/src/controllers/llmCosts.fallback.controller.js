'use strict';

const { getDb } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 * Handler for GET /api/llm_costs (underscore variant) that returns a paginated tabular list of LLM cost documents.
 *
 * Behavior kept intact:
 * - Tenant scoping: prefers req.auth.tenantId; otherwise uses x-organization-id or ?organization_id/?tenant_id
 * - Filter whitelist and date window on "timestamp" only
 * - Pagination envelope { success, data, meta }
 * - Headers for diagnostics and timings are preserved
 *
 * Small addition:
 * - Deterministically derive agent_name from nested users[].projects[].agents[].agent_name (or .name as fallback):
 *   Rule: collect all non-empty strings, distinct, sort alphabetically (case-insensitive), pick the first.
 *   This ensures non-null agent_name when nested agents are present.
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

    // Build $match including case-insensitive fallback and timestamp window
    const tenantRegex = { $regex: `^${resolvedTenant}$`, $options: 'i' };
    const baseMatchAnd = [
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
    ].filter(Boolean);

    const match = { $and: baseMatchAnd };

    // Projection base
    const baseProject = {
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
      agents: 1, // carry through computed agents
    };

    // Pipeline
    const pipeline = [
      { $match: match },

      // Compute agents array from nested users[].projects[].agents[] (names only)
      { $addFields: { _usersArr: { $ifNull: ['$users', []] } } },
      {
        $addFields: {
          _projectsNested: {
            $map: { input: '$_usersArr', as: 'u', in: { $ifNull: ['$$u.projects', []] } },
          },
        },
      },
      {
        $addFields: {
          _projectsFlat: {
            $reduce: { input: '$_projectsNested', initialValue: [], in: { $concatArrays: ['$$value', '$$this'] } },
          },
        },
      },
      {
        $addFields: {
          _agentsNested: { $map: { input: '$_projectsFlat', as: 'p', in: { $ifNull: ['$$p.agents', []] } } },
        },
      },
      {
        $addFields: {
          _agentsFlat: {
            $reduce: { input: '$_agentsNested', initialValue: [], in: { $concatArrays: ['$$value', '$$this'] } },
          },
        },
      },
      {
        $addFields: {
          agents: {
            $setUnion: [
              {
                $filter: {
                  input: {
                    $map: {
                      input: { $ifNull: ['_agentsFlat', []] },
                      as: 'a',
                      in: {
                        $ifNull: ['$$a.agent_name', { $ifNull: ['$$a.name', null] }],
                      },
                    },
                  },
                  as: 'n',
                  cond: { $ne: ['$$n', null] },
                },
              },
              [],
            ],
          },
        },
      },

      // Join users to compute user_name (stable previous behavior for underscore)
      {
        $lookup: {
          from: 'users',
          let: { userId: '$user_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$userId'] } } },
            { $project: { _id: 1, name: 1 } },
          ],
          as: 'userDoc',
        },
      },
      { $addFields: { user_name: { $ifNull: [{ $arrayElemAt: ['$userDoc.name', 0] }, 'Unknown User'] } } },
      { $project: { ...baseProject, user_name: 1 } },
    ];

    // Sorting
    if (Object.keys(sort).length > 0) {
      pipeline.push({ $sort: sort });
    }

    // Pagination with facet
    const skip = (page - 1) * limit;
    pipeline.push({
      $facet: {
        items: [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: 'count' }],
      },
    });

    // Execute aggregation on underscore collection
    const db = await getDb();
    const envName = (process.env.LLMCOSTS_COLLECTION_NAME || process.env.LLM_COSTS_COLLECTION || '').trim();
    const effectiveCollection = envName || 'llm_costs';
    const coll = db.collection(effectiveCollection);

    const execStart = Date.now();
    const [facet] = await coll.aggregate(pipeline, { allowDiskUse: true }).toArray();
    const execMs = Date.now() - execStart;

    let items = (facet && facet.items) || [];
    const total = (facet && facet.totalCount && facet.totalCount[0] && facet.totalCount[0].count) || 0;

    // Deterministic agent_name computed from aggregated agents (string[]) to avoid heavy nested traversals.
    // Self-check note: For organization_id 'T0035', when nested users[].projects[].agents[].agent_name exists,
    // the pipeline assembles agents (names) and this computation ensures agent_name is non-null.
    try {
      items = items.map((d) => {
        try {
          const names = Array.isArray(d?.agents)
            ? d.agents
                .filter((s) => typeof s === 'string' && s.trim())
                .map((s) => s.trim())
            : [];
          const distinct = Array.from(new Set(names));
          let agent_name = null;
          if (distinct.length > 0) {
            agent_name = distinct.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))[0];
          }
          if (!agent_name && typeof d?.agent_name === 'string' && d.agent_name.trim()) {
            agent_name = d.agent_name.trim();
          }
          return { ...d, agent_name: agent_name || null };
        } catch {
          return {
            ...d,
            agent_name:
              typeof d?.agent_name === 'string' && d.agent_name.trim() ? d.agent_name.trim() : null,
          };
        }
      });
    } catch {
      // No-op if enrichment fails
    }

    // Headers
    res.set('x-effective-tenant', resolvedTenant);
    res.set('x-llm-filter', JSON.stringify(match));
    res.set('x-llm-projection', JSON.stringify({ ...baseProject, user_name: 1, agents: 1 }));
    res.set('x-llm-sort', JSON.stringify(sort));
    res.set('x-llm-page', String(page));
    res.set('x-llm-limit', String(limit));
    res.set('x-llm-timing-parsed-ms', String(Date.now() - startParsed));
    res.set('x-llm-timing-exec-ms', String(execMs));
    res.set('x-llm-window-from', from.toISOString());
    res.set('x-llm-window-to', to.toISOString());
    res.set('x-llm-window-applied', applied || 'default');

    // Additional diagnostics (preserved)
    res.set('X-LLM-COSTS-Collection', effectiveCollection);
    res.set('X-LLM-COSTS-Pipeline', JSON.stringify({ match, sort, page, limit, projection: { ...baseProject, user_name: 1 } }));
    res.set('X-LLM-COSTS-Matched', String(total));

    if (String(resolvedTenant || '') === 'b2c') {
      try {
        res.set('x-llm-debug-sample', JSON.stringify(items?.[0] || null));
      } catch {}
    }

    return res.json({
      success: true,
      data: items,
      meta: {
        page,
        limit,
        total,
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
    console.error('GET /api/llm_costs error', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { listLlmCosts };
