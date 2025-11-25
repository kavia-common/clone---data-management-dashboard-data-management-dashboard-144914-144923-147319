'use strict';

const express = require('express');
const router = express.Router();

// Services and utils
const { resolveProjectName } = require('../services/projects.service');
const analytics = require('../services/analytics');
const { usdToCredits } = require('../utils/credits');
const { normalizeProjectId: normalizeProjectIdSafe } = require('../services/enrichment.util');

/**
 * Internal: round to 6 decimal places to match normalization used in routes/costs.js
 */
function round6(n) {
  const x = Number(n || 0);
  return Math.round(x * 1e6) / 1e6;
}

/**
 * Internal: compute total USD cost for a given projectId using analytics.getCosts
 */
async function computeProjectCostUSD(projectId) {
  try {
    const result = await analytics.getCosts({ project_id: projectId });
    return Number(result?.total_cost || 0);
  } catch {
    return 0;
  }
}

/**
 * Internal: build normalized payload with both camelCase and snake_case fields
 */
function buildUsagePayload({ projectId, costUSD, currency = 'USD' }) {
  const cost = round6(Number(costUSD || 0));
  const credits = usdToCredits(cost);
  return {
    projectId: String(projectId),
    costUSD: cost,
    creditsUsed: credits,
    credits_used: credits,
    currency,
  };
}

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/name
 * Returns the normalized projectId and the resolved projectName (or null if unresolved).
 * This endpoint is designed to be lenient:
 * - Always returns 200 OK with a payload { projectId, projectName, source?, info? }
 * - projectName can be null when not resolvable
 * - If the projectId format is invalid/unexpected, it still responds 200 with projectName: null and an info message
 *
 * Response:
 * 200 OK
 *  {
 *    projectId: string,         // normalized id or original if normalization failed
 *    projectName: string|null,  // resolved name or null if not found
 *    source?: 'resolver',       // optional source tag
 *    info?: string              // optional info message to hint about normalization or resolution
 *  }
 */
router.get('/:projectId/name', async (req, res) => {
  const originalId = req.params.projectId;
  let normalizedId = originalId;
  let info;

  try {
    // Normalize the project id safely (utility should avoid throwing)
    if (typeof normalizeProjectIdSafe === 'function') {
      normalizedId = normalizeProjectIdSafe(originalId);
    }

    // Call the robust resolver, which itself should look across:
    // - appDeployments
    // - projects
    // - sessionTracking
    // and use any internal caches implemented in the service.
    let projectName = null;

    try {
      projectName = await resolveProjectName(normalizedId);
    } catch (innerErr) {
      // Resolver failed unexpectedly: be graceful and surface null without breaking clients
      info = 'Resolver error encountered; returning null projectName';
    }

    // Build response
    const payload = {
      projectId: normalizedId || originalId,
      projectName: projectName ?? null,
      source: 'resolver',
    };
    if (info) {payload.info = info;}

    return res.status(200).json(payload);
  } catch (err) {
    // Graceful 200 with null name for any unexpected scenarios
    const payload = {
      projectId: normalizedId || originalId,
      projectName: null,
      source: 'resolver',
      info: 'Unexpected error; returning null projectName',
    };
    return res.status(200).json(payload);
  }
});

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/usage
 * Summary: Returns project total cost and used credits.
 * Description: Computes total USD cost for the specified project from existing LLM costs and converts to credits.
 * Parameters:
 *  - path: projectId (string)
 * Response:
 *  200 OK
 *  {
 *    projectId: string,
 *    costUSD: number,
 *    creditsUsed: number,
 *    credits_used: number,
 *    currency: 'USD'
 *  }
 */
router.get('/:projectId/usage', async (req, res) => {
  const originalId = req.params.projectId;
  const projectId = typeof normalizeProjectIdSafe === 'function' ? (normalizeProjectIdSafe(originalId) || originalId) : originalId;

  try {
    const costUSD = await computeProjectCostUSD(projectId);
    const payload = buildUsagePayload({ projectId, costUSD, currency: 'USD' });
    return res.status(200).json(payload);
  } catch (err) {
    // Return a safe default with zeroed values while preserving projectId
    const payload = buildUsagePayload({ projectId, costUSD: 0, currency: 'USD' });
    return res.status(200).json(payload);
  }
});

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/cost
 * Summary: Returns project total cost and used credits.
 * Description: Alias of /usage; kept for frontend compatibility.
 * Response: Same as /usage
 */
router.get('/:projectId/cost', async (req, res) => {
  const originalId = req.params.projectId;
  const projectId = typeof normalizeProjectIdSafe === 'function' ? (normalizeProjectIdSafe(originalId) || originalId) : originalId;

  try {
    const costUSD = await computeProjectCostUSD(projectId);
    const payload = buildUsagePayload({ projectId, costUSD, currency: 'USD' });
    return res.status(200).json(payload);
  } catch (err) {
    const payload = buildUsagePayload({ projectId, costUSD: 0, currency: 'USD' });
    return res.status(200).json(payload);
  }
});

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/cost-history-sum
 * Summary: Returns the sum of project cost over history and used credits.
 * Description: Computes total USD cost for the specified project across entire history.
 * Response:
 *  200 OK
 *  {
 *    projectId: string,
 *    costUSD: number,
 *    creditsUsed: number,
 *    credits_used: number,
 *    currency: 'USD'
 *  }
 */
router.get('/:projectId/cost-history-sum', async (req, res) => {
  const originalId = req.params.projectId;
  const projectId = typeof normalizeProjectIdSafe === 'function' ? (normalizeProjectIdSafe(originalId) || originalId) : originalId;

  try {
    const costUSD = await computeProjectCostUSD(projectId);
    const payload = buildUsagePayload({ projectId, costUSD, currency: 'USD' });
    return res.status(200).json(payload);
  } catch (err) {
    const payload = buildUsagePayload({ projectId, costUSD: 0, currency: 'USD' });
    return res.status(200).json(payload);
  }
});

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/costHistorySum
 * Summary: CamelCase alias for cost-history-sum to mirror aliasing pattern used elsewhere.
 * Response: Same as /cost-history-sum
 */
router.get('/:projectId/costHistorySum', async (req, res) => {
  const originalId = req.params.projectId;
  const projectId = typeof normalizeProjectIdSafe === 'function' ? (normalizeProjectIdSafe(originalId) || originalId) : originalId;

  try {
    const costUSD = await computeProjectCostUSD(projectId);
    const payload = buildUsagePayload({ projectId, costUSD, currency: 'USD' });
    return res.status(200).json(payload);
  } catch (err) {
    const payload = buildUsagePayload({ projectId, costUSD: 0, currency: 'USD' });
    return res.status(200).json(payload);
  }
});

module.exports = router;
