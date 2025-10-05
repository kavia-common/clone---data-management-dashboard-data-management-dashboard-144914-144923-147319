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
 * Note: This uses existing fields in documents and does not rely on any stored by_type/by_agent structures.
 */
async function getCosts({ tenant_id, project_id, user_id }) {
  const match = {};
  if (tenant_id) match.tenant_id = tenant_id;
  if (project_id) match.project_id = project_id;
  if (user_id) match.user_id = user_id;

  const pipeline = [{ $match: match }, { $project: { _id: 0, user_id: 1, project_id: 1, total_cost: 1 } }];
  const costs = await LLMCost.aggregate(pipeline);

  const total_cost = costs.reduce((acc, c) => acc + (Number(c.total_cost) || 0), 0);

  const cost_by_user = {};
  const cost_by_project = {};
  costs.forEach((c) => {
    if (c.user_id != null) {
      const k = String(c.user_id);
      cost_by_user[k] = (cost_by_user[k] || 0) + (Number(c.total_cost) || 0);
    }
    if (c.project_id) {
      const k2 = c.project_id;
      cost_by_project[k2] = (cost_by_project[k2] || 0) + (Number(c.total_cost) || 0);
    }
  });

  return { total_cost, cost_by_user, cost_by_project, records_count: costs.length };
}

module.exports = {
  getSessionDurations,
  getCosts,
};
