'use strict';

const express = require('express');
const router = express.Router();

// Services and utils
const { resolveProjectName } = require('../services/projects.service');
const { normalizeProjectId: normalizeProjectIdSafe } = require('../services/enrichment.util');

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
    if (info) payload.info = info;

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

module.exports = router;
