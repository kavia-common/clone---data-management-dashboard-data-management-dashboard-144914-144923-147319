'use strict';

const { getLlmCostByAgent } = require('../services/llmCost.service');
const { recordAudit } = require('../services/auditTrail');

/**
// PUBLIC_INTERFACE
 * getLlmCostByAgentController
 * Express handler for GET /api/analytics/llm-cost-by-agent
 * Purpose: Return aggregated LLM costs by agent, sorted descending by total_cost.
 * GxP Critical: No (read-only analytics)
 * Params: none
 * Returns: 200 JSON array [{ agent: string, total_cost: number }]
 * Errors: 500 JSON { error: string }
 */
async function getLlmCostByAgentController(req, res) {
  try {
    const items = await getLlmCostByAgent();

    // GxP Read audit (READ)
    await recordAudit({
      action: 'READ',
      resource: 'analytics.llm-cost-by-agent',
      user_id: req.user?.id || req.user?._id || null,
      outcome: 'SUCCESS',
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
      user_agent: req.get('user-agent') || '',
    }).catch(() => {});

    return res.status(200).json(items);
  } catch (err) {
    // Log error to audit trail
    await recordAudit({
      action: 'READ',
      resource: 'analytics.llm-cost-by-agent',
      user_id: req.user?.id || req.user?._id || null,
      outcome: 'ERROR',
      reason: err?.message || 'Unknown error',
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
      user_agent: req.get('user-agent') || '',
    }).catch(() => {});

    // eslint-disable-next-line no-console
    console.error('[analytics] /llm-cost-by-agent failed:', err?.message || err);
    // Acceptance: return 500 with { error: 'message' }
    return res.status(500).json({ error: 'Failed to aggregate LLM cost by agent' });
  }
}

module.exports = {
  getLlmCostByAgentController,
  // Alias to satisfy handlers expecting this name per notes
  getLlmCostByAgent: getLlmCostByAgentController,
};