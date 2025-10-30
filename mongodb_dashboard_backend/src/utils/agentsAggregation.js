'use strict';

/**
 * Utilities to aggregate agent usage and costs across:
 *  - session_tracking.agent_costs (embedded under session_tracking docs)
 *  - llm_costs.agents (embedded under llm_costs docs)
 *
 * Defensive field handling: attempts multiple field names for timestamps and identifiers.
 */

const { ObjectId } = require('mongodb');

// PUBLIC_INTERFACE
async function aggregateAgentsUsageAndCost(db, {
  tenant_id,
  project_id,
  from,
  to,
  limit = 50,
  offset = 0
} = {}) {
  /**
   * This function aggregates per-agent totals from:
   * - Collection: session_tracking
   *   Expected embedded path: agent_costs: [ { agent_name, cost, usage, timestamp? } ]
   *   Session-level fields: tenant_id, project_id, session_id, timestamps (last_updated|updatedAt|createdAt|session_start)
   * - Collection: llm_costs (or llm_cost / llmCosts etc., resolved via existing model/collection)
   *   Expected embedded path: agents: [ { name|agent_name, total_cost|cost, usage|tokens|calls } ]
   *
   * Returns:
   *  {
   *    items: [
   *      {
   *        agent_name,
   *        total_cost,
   *        total_usage,
   *        session_count,
   *        source_breakdown: {
   *          session_tracking: { cost, usage },
   *          llm_costs: { cost, usage }
   *        }
   *      }
   *    ],
   *    total,
   *    meta: { limit, offset, from, to, tenant_id, project_id }
   *  }
   */

  const sessionTrackingCol = db.collection('session_tracking');
  // The LLM costs collection name is present in this repo as llm_costs model/routes.
  const llmCostsCol = db.collection('llm_costs');

  const dateRange = {};
  if (from || to) {
    // We will apply on multiple potential timestamp fields using $or of ranges.
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

    const range = {};
    if (fromDate) range.$gte = fromDate;
    if (toDate) range.$lte = toDate;

    // Will be used inside $or later
    dateRange.$or = [
      { last_updated: range },
      { updatedAt: range },
      { createdAt: range },
      { session_start: range },
      { timestamp: range },
      { date: range }
    ];
  }

  const baseMatch = {};
  if (tenant_id) {
    baseMatch.$or = [
      { tenant_id },
      { organization_id: tenant_id },
      { org_id: tenant_id },
      { tenantId: tenant_id }
    ];
  }
  if (project_id) {
    baseMatch.$and = (baseMatch.$and || []).concat([
      {
        $or: [
          { project_id },
          { projectId: project_id },
          { 'project.id': project_id },
          { 'metadata.projectId': project_id }
        ]
      }
    ]);
  }
  if (dateRange.$or) {
    baseMatch.$and = (baseMatch.$and || []).concat([dateRange]);
  }

  // ---- Aggregate from session_tracking.agent_costs ----
  // We unwind agent_costs when present and sum cost & usage grouped by agent.
  const sessionTrackingPipeline = [
    { $match: baseMatch },
    { $project: {
        agent_costs: 1,
        // For session_count, we need distinct session-like id. Derive a stable id:
        session_identifier: {
          $ifNull: [
            '$session_id',
            { $ifNull: ['$_id', '$task_id'] }
          ]
        }
      }
    },
    { $unwind: { path: '$agent_costs', preserveNullAndEmptyArrays: false } },
    { $project: {
        agent_name: {
          $ifNull: ['$agent_costs.agent_name', '$agent_costs.name']
        },
        cost: {
          $cond: [
            { $isNumber: '$agent_costs.cost' },
            '$agent_costs.cost',
            {
              // try to parse if string with $ prefix
              $toDouble: {
                $replaceAll: { input: { $toString: '$agent_costs.cost' }, find: '$', replacement: '' }
              }
            }
          ]
        },
        usage: {
          $ifNull: [
            '$agent_costs.usage',
            { $ifNull: ['$agent_costs.tokens', '$agent_costs.calls'] }
          ]
        },
        session_identifier: 1
      }
    },
    { $match: { agent_name: { $ne: null } } },
    { $group: {
        _id: '$agent_name',
        cost: { $sum: { $ifNull: ['$cost', 0] } },
        usage: { $sum: { $ifNull: ['$usage', 0] } },
        sessions: { $addToSet: '$session_identifier' }
      }
    },
    { $project: {
        _id: 0,
        agent_name: '$_id',
        cost: 1,
        usage: 1,
        session_count: { $size: '$sessions' }
      }
    }
  ];

  // ---- Aggregate from llm_costs.agents ----
  const llmCostsMatch = {};
  if (tenant_id) {
    llmCostsMatch.$or = [
      { tenant_id },
      { organization_id: tenant_id },
      { org_id: tenant_id },
      { tenantId: tenant_id }
    ];
  }
  if (project_id) {
    llmCostsMatch.$and = (llmCostsMatch.$and || []).concat([
      {
        $or: [
          { project_id },
          { projectId: project_id },
          { 'project.id': project_id },
          { 'metadata.projectId': project_id }
        ]
      }
    ]);
  }
  if (dateRange.$or) {
    llmCostsMatch.$and = (llmCostsMatch.$and || []).concat([dateRange]);
  }

  const llmCostsPipeline = [
    { $match: llmCostsMatch },
    { $project: { agents: 1 } },
    { $unwind: { path: '$agents', preserveNullAndEmptyArrays: false } },
    { $project: {
        agent_name: {
          $ifNull: ['$agents.agent_name', '$agents.name']
        },
        cost: {
          $cond: [
            { $isNumber: '$agents.total_cost' },
            '$agents.total_cost',
            {
              $cond: [
                { $isNumber: '$agents.cost' },
                '$agents.cost',
                {
                  $toDouble: {
                    $replaceAll: { input: { $toString: { $ifNull: ['$agents.total_cost', '$agents.cost'] } }, find: '$', replacement: '' }
                  }
                }
              ]
            }
          ]
        },
        usage: {
          $ifNull: [
            '$agents.usage',
            { $ifNull: ['$agents.tokens', '$agents.calls'] }
          ]
        }
      }
    },
    { $match: { agent_name: { $ne: null } } },
    { $group: {
        _id: '$agent_name',
        cost: { $sum: { $ifNull: ['$cost', 0] } },
        usage: { $sum: { $ifNull: ['$usage', 0] } }
      }
    },
    { $project: {
        _id: 0,
        agent_name: '$_id',
        cost: 1,
        usage: 1
      }
    }
  ];

  const [sessionAgg, llmAgg] = await Promise.all([
    sessionTrackingCol.aggregate(sessionTrackingPipeline, { allowDiskUse: true }).toArray(),
    llmCostsCol.aggregate(llmCostsPipeline, { allowDiskUse: true }).toArray()
  ]);

  // Merge results by agent_name
  const map = new Map();
  for (const r of sessionAgg) {
    map.set(r.agent_name, {
      agent_name: r.agent_name,
      source_breakdown: {
        session_tracking: {
          cost: r.cost || 0,
          usage: r.usage || 0
        },
        llm_costs: {
          cost: 0,
          usage: 0
        }
      },
      session_count: r.session_count || 0
    });
  }
  for (const r of llmAgg) {
    const existing = map.get(r.agent_name);
    if (existing) {
      existing.source_breakdown.llm_costs.cost += r.cost || 0;
      existing.source_breakdown.llm_costs.usage += r.usage || 0;
    } else {
      map.set(r.agent_name, {
        agent_name: r.agent_name,
        source_breakdown: {
          session_tracking: { cost: 0, usage: 0 },
          llm_costs: { cost: r.cost || 0, usage: r.usage || 0 }
        },
        session_count: 0
      });
    }
  }

  // Compute totals and sort
  const items = Array.from(map.values()).map(x => {
    const total_cost = (x.source_breakdown.session_tracking.cost || 0) + (x.source_breakdown.llm_costs.cost || 0);
    const total_usage = (x.source_breakdown.session_tracking.usage || 0) + (x.source_breakdown.llm_costs.usage || 0);
    return {
      agent_name: x.agent_name,
      total_cost: Number(total_cost.toFixed(6)),
      total_usage,
      session_count: x.session_count,
      source_breakdown: x.source_breakdown
    };
  });

  items.sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));

  const total = items.length;
  const sliced = items.slice(offset, offset + limit);

  return {
    items: sliced,
    total,
    meta: {
      limit,
      offset,
      from: from || null,
      to: to || null,
      tenant_id: tenant_id || null,
      project_id: project_id || null
    }
  };
}

/**
 * PUBLIC_INTERFACE
 * Aggregate total user_cost grouped by users.department by joining llm_costs with users on user_id.
 * Optional filters: tenant_id, project_id, from, to. Supports limit/offset pagination.
 * Returns: { items: [{ department, total_cost, user_count }], total, meta: {...} }
 */
async function aggregateCostsByDepartment(db, {
  tenant_id,
  project_id,
  from,
  to,
  limit = 50,
  offset = 0
} = {}) {
  const llmCostsCol = db.collection('llm_costs');
  const usersColName = 'users';

  // Build permissive match on llm_costs similar to above with date window across common fields
  const andConditions = [];
  if (tenant_id) {
    andConditions.push({
      $or: [
        { tenant_id },
        { organization_id: tenant_id },
        { org_id: tenant_id },
        { tenantId: tenant_id }
      ]
    });
  }
  if (project_id) {
    andConditions.push({
      $or: [
        { project_id },
        { projectId: project_id },
        { 'project.id': project_id },
        { 'metadata.projectId': project_id }
      ]
    });
  }
  if (from || to) {
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    const range = {};
    if (fromDate) range.$gte = fromDate;
    if (toDate) range.$lte = toDate;
    andConditions.push({
      $or: [
        { timestamp: range },
        { created_at: range },
        { updated_at: range },
        { createdAt: range },
        { date: range },
      ]
    });
  }

  const matchStage = andConditions.length ? { $match: { $and: andConditions } } : null;

  const pipeline = [];
  if (matchStage) pipeline.push(matchStage);

  // Normalize user_id => string
  pipeline.push({
    $addFields: {
      user_id_str: { $toString: '$user_id' },
      total_num: {
        $ifNull: [
          {
            $toDouble: {
              $ifNull: ['$total_cost', { $ifNull: ['$cost', 0] }]
            }
          },
          0
        ]
      }
    }
  });

  // Join with users on user_id_str to resolve department
  pipeline.push({
    $lookup: {
      from: usersColName,
      let: { uid: '$user_id_str' },
      pipeline: [
        {
          $match: {
            $expr: {
              $eq: [{ $toString: '$user_id' }, '$$uid']
            }
          }
        },
        {
          $project: {
            _id: 0,
            department: 1,
            organization_id: 1,
            tenant_id: 1
          }
        }
      ],
      as: 'user_doc'
    }
  });

  // Determine department with fallback to 'unknown'
  pipeline.push({
    $addFields: {
      department: {
        $let: {
          vars: { u: { $arrayElemAt: ['$user_doc', 0] } },
          in: {
            $cond: [
              { $in: [{ $type: '$$u.department' }, ['string']] },
              {
                $cond: [
                  { $eq: [{ $trim: { input: '$$u.department' } }, ''] },
                  'unknown',
                  { $trim: { input: '$$u.department' } }
                ]
              },
              'unknown'
            ]
          }
        }
      }
    }
  });

  // Group by department: sum cost and count distinct users in that department
  pipeline.push(
    {
      $group: {
        _id: '$department',
        total_cost: { $sum: '$total_num' },
        users: { $addToSet: '$user_id_str' }
      }
    },
    {
      $project: {
        _id: 0,
        department: '$_id',
        total_cost: { $round: ['$total_cost', 6] },
        user_count: { $size: '$users' }
      }
    },
    { $sort: { total_cost: -1, department: 1 } }
  );

  const all = await llmCostsCol.aggregate(pipeline, { allowDiskUse: true }).toArray();
  const total = all.length;
  const items = all.slice(offset, offset + limit);

  return {
    items,
    total,
    meta: {
      limit,
      offset,
      from: from || null,
      to: to || null,
      tenant_id: tenant_id || null,
      project_id: project_id || null,
      grouping: 'department'
    }
  };
}

module.exports = {
  aggregateAgentsUsageAndCost,
  aggregateCostsByDepartment
};
