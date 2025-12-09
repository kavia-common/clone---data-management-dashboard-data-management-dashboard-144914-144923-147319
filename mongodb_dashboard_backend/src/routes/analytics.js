const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/llm-cost-by-agent
 * Aggregates LLM costs by agent from llmCosts service to preserve analytics unrelated to removed charts.
 */
const llmCostsAggregate = require('../services/llmCost.service');

router.get('/llm-cost-by-agent', async (req, res, next) => {
  try {
    // Delegate to llmCost.service when a helper exists, otherwise implement a minimal aggregation.
    if (typeof llmCostsAggregate.aggregateCostByAgent === 'function') {
      const result = await llmCostsAggregate.aggregateCostByAgent(req, res);
      if (!res.headersSent) return res.json(result);
      return;
    }

    // Fallback: inline simple aggregation via Mongo if service function isn't available.
    const { getDb } = require('../config/db');
    const dbo = await getDb();
    const col = dbo.collection('llm_costs');
    const pipeline = [
      {
        $unwind: {
          path: '$Agents',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $group: {
          _id: '$Agents.Agent Name',
          total_cost: {
            $sum: {
              $toDouble: {
                $replaceAll: { input: { $ifNull: ['$Agents.Total Cost', '0'] }, find: '$', replacement: '' }
              }
            }
          }
        }
      },
      { $project: { agent: '$_id', total_cost: 1, _id: 0 } },
      { $sort: { total_cost: -1 } }
    ];
    const items = await col.aggregate(pipeline).toArray();
    return res.json(items);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
