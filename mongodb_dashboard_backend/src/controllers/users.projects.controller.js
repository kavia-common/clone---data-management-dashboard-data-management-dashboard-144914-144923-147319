'use strict';

const { getUserProjectsFromSessions } = require('../services/users.service');

/**
 * PUBLIC_INTERFACE
 * getUserProjectsController
 * Express handler for GET /api/users/:userId/projects
 * Enforces tenant scoping via req.organizationId/req.tenantId (requireTenant/extractOrganization).
 */
async function getUserProjectsController(req, res) {
  const { userId } = req.params || {};
  const normalizedUserId = String(userId || '').trim();
  const tenantId = req.organizationId || req.tenantId;

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message:
        'Missing tenant scope: include Authorization (JWT) or header x-organization-id or query ?tenant_id / ?organization_id',
    });
  }
  if (!normalizedUserId) {
    return res.status(400).json({ success: false, message: 'userId path parameter is required' });
  }

  const { from, to } = req.query || {};
  // Diagnostics headers
  try {
    res.set('X-Endpoint', 'users-user-projects');
    res.set('X-User-Id', normalizedUserId);
    res.set('X-Applied-Tenant', String(tenantId));
  } catch (_) {}

  const payload = await getUserProjectsFromSessions({
    tenantId: String(tenantId),
    userId: normalizedUserId,
    from,
    to,
  });

  const page = Number(req.query.page || 0);
  const limit = Number(req.query.limit || 0);
  if (page > 0 && limit > 0) {
    const start = (page - 1) * limit;
    const end = start + limit;
    const sliced = (payload.projects || []).slice(start, end);
    return res.status(200).json({
      success: true,
      data: sliced,
      meta: { page, limit, total: (payload.projects || []).length },
      user_id: payload.user_id,
      tenant_id: payload.tenant_id,
    });
  }

  return res.status(200).json(payload);
}

module.exports = {
  getUserProjectsController,
};
