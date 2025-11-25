const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * getUserCosts
 * Aggregates total cost for a user from llm_costs with breakdowns by agent_name and type (if present).
 *
 * Note: The llm_costs schema is permissive. We project possible alias fields into normalized keys:
 * - agent_name: from agent_name | agent | metadata.agent_name
 * - type: from type | service_type | operation
 *
 * @param {string|number} userId - User identifier; will be compared as string by coercing user_id with $toString
 * @returns {Promise<{ userId: string, total_cost: number, user_cost: number, currency?: string, by_agent: Array<{agent_name: string, total_cost: number}>, by_type: Array<{type: string, total_cost: number}> }>}
 */
async function getUserCosts(userId, req = undefined) {
  const userIdStr = String(userId);

  // Common $match: compare by string
  const match = {
    $expr: { $eq: [{ $toString: '$user_id' }, userIdStr] },
  };

  // Projection stage to normalize fields and ensure numeric total_cost
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
    // normalized fields
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

  // Overall total
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

  // By agent
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

  // By type
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
  const currency = Array.isArray(overall.currencies) && overall.currencies.length === 1
    ? overall.currencies[0]
    : 'USD';

  return {
    userId: userIdStr,
    total_cost,
    user_cost: total_cost, // alias as requested
    currency,
    by_agent: byAgent.map((a) => ({
      agent_name: a.agent_name === '__unknown__' ? 'unknown' : a.agent_name,
      total_cost: Number(a.total_cost || 0),
    })),
    by_type: byType.map((t) => ({
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
 * @param {string|number} userId
 * @returns {Promise<Array<{ projectId: string, project_cost: number, agents: Array<{agent_name: string, total_cost: number}> }>>}
 */
async function getUserProjectsCosts(userId, req = undefined) {
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

  // Group by project and agent first
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

  // Normalize unknown labels and numeric values
  const normalized = results
    .filter((r) => r.projectId) // ignore null projects
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
