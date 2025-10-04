const SessionTracking = require('../models/sessionTracking.model');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * Compute total session duration in minutes and breakdowns grouped by user and/or project.
 */
async function getSessionDurations({ tenant_id, project_id, user_id }) {
  const match = {};
  if (tenant_id) match.tenant_id = tenant_id;
  if (project_id) match.project_id = project_id;
  if (user_id) match.user_id = user_id;

  // Compute duration in minutes for each session: if session_end missing, use now.
  const now = new Date();
  const pipeline = [
    { $match: match },
    {
      $addFields: {
        session_end_fallback: { $ifNull: ['$session_end', now] },
      },
    },
    {
      $addFields: {
        duration_ms: { $subtract: ['$session_end_fallback', '$session_start'] },
      },
    },
    {
      $addFields: {
        duration_minutes: { $divide: ['$duration_ms', 1000 * 60] },
      },
    },
  ];

  const sessions = await SessionTracking.aggregate([...pipeline, { $project: { _id: 0, user_id: 1, project_id: 1, duration_minutes: 1 } }]);

  const total_minutes = sessions.reduce((acc, s) => acc + (s.duration_minutes || 0), 0);

  // Group by user
  const minutes_by_user = {};
  // Group by project
  const minutes_by_project = {};
  sessions.forEach((s) => {
    if (s.user_id != null) {
      const k = String(s.user_id);
      minutes_by_user[k] = (minutes_by_user[k] || 0) + (s.duration_minutes || 0);
    }
    if (s.project_id) {
      const k2 = s.project_id;
      minutes_by_project[k2] = (minutes_by_project[k2] || 0) + (s.duration_minutes || 0);
    }
  });

  return { total_minutes, minutes_by_user, minutes_by_project, sessions_count: sessions.length };
}

/**
 * PUBLIC_INTERFACE
 * Compute total costs and breakdowns from LLMCost collection grouped by user and/or project.
 */
async function getCosts({ tenant_id, project_id, user_id }) {
  const match = {};
  if (tenant_id) match.tenant_id = tenant_id;
  if (project_id) match.project_id = String(project_id);
  if (user_id) match.user_id = user_id;

  // Build a robust pipeline:
  // - Match by provided filters
  // - Project a numeric cost field that prefers total_cost, then amount, else 0
  // - Coerce Decimal128/String/Null to Number via $toDouble with $ifNull
  // - Return lightweight docs for JS-side grouping
  const pipeline = [
    { $match: match },
    {
      $project: {
        _id: 0,
        user_id: 1,
        project_id: 1,
        cost_num: {
          $toDouble: {
            $ifNull: [
              {
                $ifNull: ['$total_cost', '$amount'],
              },
              0,
            ],
          },
        },
      },
    },
  ];

  let costs = [];
  try {
    costs = await LLMCost.aggregate(pipeline);
  } catch (err) {
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== 'production') {
      console.error('getCosts aggregation error:', err?.message || err);
    }
    costs = [];
  }

  const total_cost = costs.reduce((acc, c) => acc + (Number(c.cost_num) || 0), 0);

  const cost_by_user = {};
  const cost_by_project = {};
  for (const c of costs) {
    if (c.user_id != null) {
      const k = String(c.user_id);
      cost_by_user[k] = (cost_by_user[k] || 0) + (Number(c.cost_num) || 0);
    }
    if (c.project_id) {
      const k2 = String(c.project_id);
      cost_by_project[k2] = (cost_by_project[k2] || 0) + (Number(c.cost_num) || 0);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('getCosts debug:', {
      filters: { tenant_id, project_id, user_id },
      records_count: costs.length,
      total_cost,
    });
  }

  return { total_cost, cost_by_user, cost_by_project, records_count: costs.length };
}

module.exports = {
  getSessionDurations,
  getCosts,
};
