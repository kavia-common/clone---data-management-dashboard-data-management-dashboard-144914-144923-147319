'use strict';

const { getDb } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 * Handler for GET /api/llm_costs
 */
async function listLlmCosts(req, res) {
  const startParsed = Date.now();

  try {
    // ---------------------------
    // Resolve tenant
    // ---------------------------
    const jwtTenant = req?.auth?.tenantId;
    const headerTenant =
      req.headers['x-organization-id'] ||
      req.query.organization_id ||
      req.query.tenant_id;

    let resolvedTenant = null;

    if (jwtTenant) {
      resolvedTenant = String(jwtTenant);
      if (headerTenant && String(headerTenant) !== resolvedTenant) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: tenant scope mismatch with JWT tenant.',
        });
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

    // ---------------------------
    // Pagination & sorting
    // ---------------------------
    const defaultLimit = Number(process.env.DEFAULT_PAGE_LIMIT || 50);
    const maxLimit = 200;

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limitRaw = parseInt(req.query.limit || defaultLimit, 10);
    const limit =
      !Number.isFinite(limitRaw) || limitRaw <= 0
        ? defaultLimit
        : limitRaw;

    if (limit > maxLimit) {
      return res
        .status(400)
        .json({ success: false, message: `limit must be <= ${maxLimit}` });
    }

    const sortStr = (req.query.sort || '-timestamp').trim();
    const sort = {};
    sortStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => {
        sort[s.startsWith('-') ? s.slice(1) : s] = s.startsWith('-') ? -1 : 1;
      });

    // ---------------------------
    // Date window
    // ---------------------------
    const now = new Date();
    const maxDays = Number(process.env.MAX_DAYS_WINDOW || 90);

    const to = req.query.to ? new Date(req.query.to) : now;
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(now.getTime() - maxDays * 86400000);

    // ---------------------------
    // Filters
    // ---------------------------
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
        return res
          .status(400)
          .json({ success: false, message: 'Invalid filter JSON' });
      }
    }

    const tenantRegex = { $regex: `^${resolvedTenant}$`, $options: 'i' };

    const match = {
      $and: [
        {
          $or: [
            { organization_id: resolvedTenant },
            { tenant_id: resolvedTenant },
            { organization_id: tenantRegex },
            { tenant_id: tenantRegex },
          ],
        },
        { timestamp: { $gte: from, $lte: to } },
        Object.keys(extraFilter).length ? extraFilter : null,
      ].filter(Boolean),
    };

    // ---------------------------
    // Projection
    // ---------------------------
    const baseProject = {
      request_id: 1,
      session_id: 1,
      project_id: 1,
      timestamp: 1,
      created_at: 1,
      provider: 1,
      user_id: 1,
      organization_id: 1,
      tenant_id: 1,
      cost_usd: 1,
      total_cost: 1,
      status: 1,
      details: 1,
      agents: 1,      // ✅ REQUIRED
      agent_name: 1,  // fallback only
      user_name: 1,
    };

    // ---------------------------
    // Aggregation pipeline
    // ---------------------------
    const pipeline = [
      { $match: match },

      // Flatten users → projects → agents
      { $addFields: { _users: { $ifNull: ['$users', []] } } },
      {
        $addFields: {
          _projects: {
            $reduce: {
              input: {
                $map: {
                  input: '$_users',
                  as: 'u',
                  in: { $ifNull: ['$$u.projects', []] },
                },
              },
              initialValue: [],
              in: { $concatArrays: ['$$value', '$$this'] },
            },
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
                      input: {
                        $reduce: {
                          input: '$_projects',
                          initialValue: [],
                          in: {
                            $concatArrays: [
                              '$$value',
                              { $ifNull: ['$$this.agents', []] },
                            ],
                          },
                        },
                      },
                      as: 'a',
                      in: {
                        $ifNull: ['$$a.agent_name', '$$a.name'],
                      },
                    },
                  },
                  as: 'n',
                  cond: { $and: [{ $ne: ['$$n', null] }, { $ne: ['$$n', ''] }] },
                },
              },
              [],
            ],
          },
        },
      },

      // Join user name
      {
        $lookup: {
          from: 'users',
          let: { uid: '$user_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$uid'] } } },
            { $project: { name: 1 } },
          ],
          as: 'userDoc',
        },
      },
      {
        $addFields: {
          user_name: {
            $ifNull: [{ $arrayElemAt: ['$userDoc.name', 0] }, 'Unknown User'],
          },
        },
      },

      { $project: baseProject },
      { $sort: sort },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    // ---------------------------
    // Execute
    // ---------------------------
    const db = await getDb();
    const coll = db.collection(process.env.LLM_COSTS_COLLECTION || 'llm_costs');

    const [facet] = await coll.aggregate(pipeline, { allowDiskUse: true }).toArray();

    let items = facet?.items || [];
    const total = facet?.totalCount?.[0]?.count || 0;

    // ---------------------------
    // FINAL agent_name derivation (STRICT FALLBACK)
    // ---------------------------
    // Requirement: derive agent_name only from the already-aggregated `agents` array
    // - Trim strings, filter non-empty, dedupe, sort case-insensitive, pick first
    // - If nothing usable, leave as null (do not reintroduce users/projects or other heavy fields)
    items = items.map((d) => {
      const names = Array.isArray(d.agents)
        ? Array.from(
            new Set(
              d.agents
                .filter((x) => typeof x === 'string' && x.trim())
                .map((x) => x.trim())
            )
          ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        : [];

      return {
        ...d,
        agent_name: names.length > 0 ? names[0] : null,
      };
    });

    // ---------------------------
    // Response
    // ---------------------------
    return res.json({
      success: true,
      data: items,
      meta: {
        page,
        limit,
        total,
        sort: sortStr,
        window: { from: from.toISOString(), to: to.toISOString() },
      },
    });
  } catch (err) {
    console.error('GET /api/llm_costs error', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

module.exports = { listLlmCosts };
