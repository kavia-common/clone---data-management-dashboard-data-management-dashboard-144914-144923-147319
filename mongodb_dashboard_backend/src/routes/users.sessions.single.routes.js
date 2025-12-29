const express = require('express');
const router = express.Router();

// Models
const SessionTracking = require('../models/sessionTracking.model');
const { parseJSONSafe } = require('../utils/validators');
const tenantScope = require('../middleware/tenantScope');
const extractOrganization = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/users/:userId/sessions
 * Returns session_tracking records filtered by user_id and optional organization_id/tenant_id.
 * Mirrors the pattern of /api/users/:userId/projects but returns raw session documents (paginated if page/limit provided).
 */
router.get(
  '/:userId/sessions',
  // Extract effective organization/tenant context (supports header/query aliases)
  extractOrganization,
  // Enforce tenant scoping when applicable (aligns with other users endpoints)
  tenantScope,
  async (req, res, next) => {
    try {
      const { userId } = req.params;

      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'Invalid or missing userId' });
      }

      // Resolve tenant scope: prefer header x-organization-id, then query tenant_id/organization_id,
      // and allow middleware (tenantScope) to override when JWT is provided.
      const headerOrg = req.headers['x-organization-id'];
      const queryTenant = req.query.tenant_id || req.query.organization_id || null;
      const effectiveTenant = (req.auth && req.auth.tenantId) || headerOrg || queryTenant || null;

      // Base filter including user
      const filter = { user_id: String(userId) };

      // If tenant is provided/resolved, add it to filter using aliases found in data
      if (effectiveTenant) {
        // session_tracking may store either tenant_id or organization_id; match either
        filter.$or = [
          { tenant_id: String(effectiveTenant) },
          { organization_id: String(effectiveTenant) },
        ];
      }

      // Optional additional filter via JSON string (whitelisted keys for safety)
      let clientFilter = {};
      if (req.query.filter) {
        clientFilter = parseJSONSafe(req.query.filter, {});
        const allowed = [
          'status',
          'session_id',
          'project_id',
          'request_id',
          'timestamp',
          'created_at',
          'service_type',
          'provider',
          'llm_model',
        ];
        Object.keys(clientFilter).forEach((k) => {
          if (!allowed.includes(k)) {
            delete clientFilter[k];
          }
        });
      }

      const sort = req.query.sort || '-timestamp';

      // Pagination controls (optional)
      let { page, limit, pageSize } = req.query;
      if (pageSize && !limit) limit = pageSize; // alias
      page = parseInt(page, 10);
      limit = parseInt(limit, 10);
      const hasPagination = Number.isInteger(page) && Number.isInteger(limit) && page > 0 && limit > 0;

      const effectiveFilter = { ...filter, ...clientFilter };

      // Query building
      const projection = {}; // full docs
      const sortSpec = (() => {
        if (!sort) return { timestamp: -1 };
        const fields = sort.split(',').map((s) => s.trim()).filter(Boolean);
        const s = {};
        fields.forEach((f) => {
          if (f.startsWith('-')) {
            s[f.substring(1)] = -1;
          } else if (f.startsWith('+')) {
            s[f.substring(1)] = 1;
          } else {
            s[f] = 1;
          }
        });
        return Object.keys(s).length ? s : { timestamp: -1 };
      })();

      if (!hasPagination) {
        const items = await SessionTracking.find(effectiveFilter, projection).sort(sortSpec).lean().exec();
        res.set('x-effective-tenant', effectiveTenant || '');
        res.set('x-users-sessions-sort', JSON.stringify(sortSpec));
        return res.json(items);
      }

      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        SessionTracking.find(effectiveFilter, projection).sort(sortSpec).skip(skip).limit(limit).lean().exec(),
        SessionTracking.countDocuments(effectiveFilter).exec(),
      ]);

      res.set('x-effective-tenant', effectiveTenant || '');
      res.set('x-users-sessions-sort', JSON.stringify(sortSpec));
      res.set('x-users-sessions-page', String(page));
      res.set('x-users-sessions-limit', String(limit));

      return res.json({
        success: true,
        data: items,
        meta: {
          page,
          limit,
          total,
          sort: sortSpec,
        },
      });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
