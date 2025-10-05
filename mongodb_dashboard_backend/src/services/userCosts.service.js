const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * getUserCosts
 * Aggregates total cost for a user from llm_costs with breakdowns based on existing fields.
 *
 * Implementation notes:
 * - This service does NOT rely on any non-existent by_type/by_agent stored fields.
 * - It derives breakdowns using present fields:
 *     agent_name: from agent_name | agent | metadata.agent_name
 *     type: from type | service_type | operation
 * - It returns aliases:
 *     user_cost = total_cost for the user
 *
 * @param {string|number} userId - User identifier; coerced to string for comparison against user_id
 * @returns {Promise<{ userId: string, total_cost: number, user_cost: number, currency?: string, by_agent: Array<{agent_name: string, total_cost: number}>, by_type: Array<{type: string, total_cost: number}> }>}
 */
async function getUserCosts(userId) {
  const userIdStr = String(userId);

  // $match using $toString to accommodate mixed-type user_id
  const match = {
    $expr: { $eq: [{ $toString: '$user_id' }, userIdStr] },
  };

  // Normalize and coerce cost to double
  const projectNormalized = {
    _id: 0,
    total_cost_num: {
      $cond: [
        { $ne: ['$total_cost', null] },
        {
          $convert: {
            input: {
              $cond: [
                { $isNumber: '$total_cost' },
                '$total_cost',
                { $toString: '$total_cost' },
              ],
            },
            to: 'double',
            onError: 0,
            onNull: 0,
          },
        },
        0,
      ],
    },
    currency: { $ifNull: ['$currency', 'USD'] },
    agent_name: {
      $ifNull: [
        '$agent_name',
        { $ifNull: ['$agent', '$metadata.agent_name'] },
      ],
    },
    type: {
      $ifNull: [
        '$type',
        { $ifNull: ['$service_type', '$operation'] },
      ],
    },
  };

  const overallPipeline = [
    { $match: match },
    { $project: projectNormalized },
    {
      $group: {
        _id: null,
        total_cost: { $sum: '$total_cost_num' },
        currencies: { $addToSet: '$currency' },
      },
    },
  ];

  const byAgentPipeline = [
    { $match: match },
    { $project: projectNormalized },
    {
      $group: {
        _id: { $ifNull: ['$agent_name', '__unknown__'] },
        total_cost: { $sum: '$total_cost_num' },
      },
    },
    { $project: { _id: 0, agent_name: '$_id', total_cost: 1 } },
    { $sort: { total_cost: -1 } },
  ];

  const byTypePipeline = [
    { $match: match },
    { $project: projectNormalized },
    {
      $group: {
        _id: { $ifNull: ['$type', '__unknown__'] },
        total_cost: { $sum: '$total_cost_num' },
      },
    },
    { $project: { _id: 0, type: '$_id', total_cost: 1 } },
    { $sort: { total_cost: -1 } },
  ];

  const [overallArr, byAgent, byType] = await Promise.all([
    LLMCost.aggregate(overallPipeline),
    LLMCost.aggregate(byAgentPipeline),
    LLMCost.aggregate(byTypePipeline),
  ]);

  const overall = overallArr?.[0] || { total_cost: 0, currencies: ['USD'] };
  const total_cost = Number(overall.total_cost || 0);
  const currency =
    Array.isArray(overall.currencies) && overall.currencies.length === 1
      ? overall.currencies[0]
      : 'USD';

  return {
    userId: userIdStr,
    total_cost,
    user_cost: total_cost,
    currency,
    by_agent: (byAgent || []).map((a) => ({
      agent_name: a.agent_name === '__unknown__' ? 'unknown' : a.agent_name,
      total_cost: Number(a.total_cost || 0),
    })),
    by_type: (byType || []).map((t) => ({
      type: t.type === '__unknown__' ? 'unknown' : t.type,
      total_cost: Number(t.total_cost || 0),
    })),
  };
}

/**
 * PUBLIC_INTERFACE
 * getUserProjectsCosts
 * Aggregates costs for a user grouped by project, with agent_name subtotals.
 *
 * Returns array of:
 *   { projectId, project_cost, agents: [{ agent_name, total_cost }] }
 *
 * Note:
 * - No reliance on by_type/by_agent stored fields; we compute using current doc fields.
 *
 * @param {string|number} userId
 * @returns {Promise<Array<{ projectId: string, project_cost: number, agents: Array<{agent_name: string, total_cost: number}> }>>}
 */
async function getUserProjectsCosts(userId) {
  const userIdStr = String(userId);

  const match = {
    $expr: { $eq: [{ $toString: '$user_id' }, userIdStr] },
  };

  const projectNormalized = {
    _id: 0,
    project_id: '$project_id',
    agent_name: {
      $ifNull: [
        '$agent_name',
        { $ifNull: ['$agent', '$metadata.agent_name'] },
      ],
    },
    total_cost_num: {
      $cond: [
        { $ne: ['$total_cost', null] },
        {
          $convert: {
            input: {
              $cond: [
                { $isNumber: '$total_cost' },
                '$total_cost',
                { $toString: '$total_cost' },
              ],
            },
            to: 'double',
            onError: 0,
            onNull: 0,
          },
        },
        0,
      ],
    },
  };

  const pipeline = [
    { $match: match },
    { $project: projectNormalized },
    {
      $group: {
        _id: {
          project_id: '$project_id',
          agent_name: { $ifNull: ['$agent_name', '__unknown__'] },
        },
        agent_cost: { $sum: '$total_cost_num' },
      },
    },
    {
      $group: {
        _id: '$_id.project_id',
        agents: {
          $push: {
            agent_name: '$_id.agent_name',
            total_cost: '$agent_cost',
          },
        },
        project_cost: { $sum: '$agent_cost' },
      },
    },
    {
      $project: {
        _id: 0,
        projectId: '$_id',
        project_cost: 1,
        agents: 1,
      },
    },
    { $sort: { project_cost: -1 } },
  ];

  const results = await LLMCost.aggregate(pipeline);

  const normalized = (results || [])
    .filter((r) => r.projectId) // drop null/empty projectId
    .map((r) => ({
      projectId: r.projectId,
      project_cost: Number(r.project_cost || 0),
      agents: (r.agents || []).map((a) => ({
        agent_name: a.agent_name === '__unknown__' ? 'unknown' : a.agent_name,
        total_cost: Number(a.total_cost || 0),
      })),
    }));

  return normalized;
}

module.exports = {
  getUserCosts,
  getUserProjectsCosts,
};
