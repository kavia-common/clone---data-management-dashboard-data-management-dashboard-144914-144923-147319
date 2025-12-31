'use strict';

const SessionTracking = require('../models/sessionTracking.model');
const Project = require('../models/project.model');

/**
 * Determine if the request should run in "all tenants" mode.
 * We treat tenant selector "T0000" (case-insensitive) as global for this endpoint.
 *
 * @param {string} tenantIdRaw raw tenant/organization id
 * @param {any} req express req
 * @returns {boolean}
 */
function isAllTenantsMode(tenantIdRaw, req) {
  const t = tenantIdRaw !== undefined && tenantIdRaw !== null ? String(tenantIdRaw) : '';
  const isT0000 = /^T0+$/i.test(t.trim());
  const bypassFlag = !!(req && (req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin || req.usersAllTenantsBypass));
  return isT0000 || bypassFlag;
}

/**
 * PUBLIC_INTERFACE
 * getUserProjectsFromSessions
 * Aggregates distinct projects for a given user based on session_tracking data.
 *
 * Behavior:
 * - When tenantId is "T0000" (case-insensitive) OR bypass flags are present on req,
 *   runs in all-tenants mode and does NOT apply any tenant/org filters.
 * - Otherwise, strictly scopes to the provided tenantId using common alias fields.
 * - If from/to are provided, applies them consistently across timestamp/session_start/last_updated.
 */
async function getUserProjectsFromSessions({ tenantId, userId, from, to, req = undefined }) {
  const userIdString = String(userId);
  const tenantIdString = tenantId !== undefined && tenantId !== null ? String(tenantId) : '';

  const timeClauses = [];
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (fromDate || toDate) {
    const makeRange = (field) => {
      const r = {};
      if (fromDate) r.$gte = fromDate;
      if (toDate) r.$lte = toDate;
      return { [field]: r };
    };
    timeClauses.push(makeRange('timestamp'));
    timeClauses.push(makeRange('session_start'));
    timeClauses.push(makeRange('last_updated'));
  }

  const allTenantsMode = isAllTenantsMode(tenantIdString, req);

  try {
    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      console.debug(
        `[users.service] getUserProjectsFromSessions allTenantsMode=${allTenantsMode} tenantId=${tenantIdString} usersAllTenantsBypass=${!!(req && req.usersAllTenantsBypass)}`
      );
    }
  } catch {}

  const baseMatch = {
    $expr: { $eq: [{ $toString: '$user_id' }, userIdString] },
    ...(timeClauses.length
      ? {
          $or: timeClauses.map((clause) => {
            const key = Object.keys(clause)[0];
            const cond = clause[key];
            if (!cond.$gte && !cond.$lte) return { [key]: { $exists: true } };
            return clause;
          }),
        }
      : {}),
  };

  // IMPORTANT:
  // Session tracking data may store tenant identifiers under different field names.
  // For non-global mode we apply an $or across known aliases.
  const matchStage = {
    $match: allTenantsMode
      ? baseMatch
      : {
          ...baseMatch,
          $or: [
            { tenant_id: tenantIdString },
            { organization_id: tenantIdString },
            { organizationId: tenantIdString },
            { tenantId: tenantIdString },
            { orgId: tenantIdString },
            { 'tenant.tenant_id': tenantIdString },
          ],
        },
  };

  const pipeline = [
    matchStage,
    {
      $group: {
        _id: '$project_id',
        last_activity: {
          $max: {
            $ifNull: [
              '$last_updated',
              { $ifNull: ['$session_end', { $ifNull: ['$timestamp', '$session_start'] }] },
            ],
          },
        },
      },
    },
    { $project: { _id: 0, project_id: '$_id', last_activity: 1 } },
    { $sort: { last_activity: -1 } },
  ];

  const grouped = await SessionTracking.aggregate(pipeline);

  const projectIds = grouped.map((g) => g.project_id).filter(Boolean);
  let projectNamesMap = {};
  if (projectIds.length > 0) {
    // Preserve legacy behavior for non-global mode: projects names are tenant-scoped.
    // In all-tenants mode, do NOT tenant-scope project name lookup so the UI can display names.
    const findFilter = allTenantsMode
      ? { project_id: { $in: projectIds } }
      : {
          project_id: { $in: projectIds },
          $or: [
            { tenant_id: tenantIdString },
            { organization_id: tenantIdString },
            { organizationId: tenantIdString },
            { tenantId: tenantIdString },
            { orgId: tenantIdString },
            { 'tenant.tenant_id': tenantIdString },
          ],
        };

    const projects = await Project.find(findFilter, { project_id: 1, project_name: 1 }).lean();
    projectNamesMap = projects.reduce((acc, p) => {
      acc[p.project_id] = p.project_name || null;
      return acc;
    }, {});
  }

  const projects = grouped
    .filter((g) => !!g.project_id)
    .map((g) => ({
      project_id: g.project_id,
      project_name: Object.prototype.hasOwnProperty.call(projectNamesMap, g.project_id)
        ? projectNamesMap[g.project_id]
        : undefined,
      last_activity: g.last_activity ? new Date(g.last_activity).toISOString() : undefined,
    }));

  return {
    user_id: userIdString,
    // Maintain backward-compatible response shape: keep tenant_id as the incoming selector
    // (even if it's T0000) so the frontend doesn't break.
    tenant_id: tenantIdString,
    projects,
  };
}

const usersService = { getUserProjectsFromSessions };
module.exports = usersService;
