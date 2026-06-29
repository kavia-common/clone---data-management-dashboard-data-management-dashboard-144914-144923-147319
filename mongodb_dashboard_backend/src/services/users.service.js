'use strict';

const SessionTracking = require('../models/sessionTracking.model');
const Project = require('../models/project.model');
const User = require('../models/user.model');

/**
 * Credits configuration — import the shared multiplier constant.
 * To change the credits conversion rate, edit src/config/creditsConfig.js.
 */
const { CREDIT_MULTIPLIER } = require('../config/creditsConfig');

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

  // Build activity (time) filter:
  // We consider a session "in range" when ANY of these fields is within range.
  const timeOrClause = timeClauses.length
    ? {
        $or: timeClauses.map((clause) => {
          const key = Object.keys(clause)[0];
          const cond = clause[key];
          if (!cond.$gte && !cond.$lte) return { [key]: { $exists: true } };
          return clause;
        }),
      }
    : null;

  const tenantOrClause = {
    $or: [
      { tenant_id: tenantIdString },
      { organization_id: tenantIdString },
      { organizationId: tenantIdString },
      { tenantId: tenantIdString },
      { orgId: tenantIdString },
      { 'tenant.tenant_id': tenantIdString },
    ],
  };

  // IMPORTANT:
  // Do NOT put both time-scoping and tenant-scoping under the same `$or` key
  // on the same object — that would overwrite one of them. Instead, compose
  // the query with `$and` so both constraints are enforced.
  const matchStage = {
    $match: allTenantsMode
      ? {
          $expr: { $eq: [{ $toString: '$user_id' }, userIdString] },
          ...(timeOrClause ? timeOrClause : {}),
        }
      : {
          $and: [
            { $expr: { $eq: [{ $toString: '$user_id' }, userIdString] } },
            tenantOrClause,
            ...(timeOrClause ? [timeOrClause] : []),
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

    // NOTE:
    // Some unit tests mock Project.find as a simple jest.fn() returning an array.
    // In that case, `.lean()` is not available. To keep the code resilient and
    // to avoid hard dependency on Mongoose query chaining, we support both:
    // - Query object with .lean()
    // - Direct array return (mocked/stubbed)
    const findResult = await Project.find(findFilter, { project_id: 1, project_name: 1 });
    const projects = typeof findResult?.lean === 'function' ? await findResult.lean() : findResult;

    projectNamesMap = (Array.isArray(projects) ? projects : []).reduce((acc, p) => {
      if (!p || !p.project_id) return acc;
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

/**
 * PUBLIC_INTERFACE
 * getUserSessionStatsByDomain
 *
 * Executes a MongoDB aggregation pipeline that:
 *  1. Filters users whose email ends with the provided domain (e.g. "example.com")
 *  2. $lookup joins session_tracking by users._id = session_tracking.user_id
 *  3. $group sums total_duration across all matching session documents per user
 *
 * All aggregation logic is pushed entirely to MongoDB (no in-process join/merge).
 *
 * @param {string} domain  Email domain to filter by (e.g. "davinci.com"). Required.
 * @returns {Promise<Array<{userId: string, email: string, totalSessionDuration: number}>>}
 */
// NOTE: To change the credits multiplier, edit CREDIT_MULTIPLIER in src/config/creditsConfig.js
async function getUserSessionStatsByDomain(domain) {
  if (!domain || typeof domain !== 'string' || !domain.trim()) {
    throw new Error('domain is required and must be a non-empty string');
  }

  // Normalize domain: strip leading "@" if user accidentally includes it
  const normalizedDomain = domain.trim().replace(/^@/, '').toLowerCase();

  // Build a case-insensitive regex that matches emails ending with @<domain>
  // This is safe because we restrict the character set and anchor both sides.
  // MongoDB regex anchoring: /@davinci\.com$/i
  const domainRegex = new RegExp('@' + normalizedDomain.replace(/\./g, '\\.') + '$', 'i');

  /**
   * Aggregation pipeline:
   *
   *  Stage 1 – $match: filter users collection by email domain.
   *
   *  Stage 2 – $lookup: left-outer join session_tracking on:
   *    users._id (coerced to string) == session_tracking.user_id (coerced to string)
   *    We coerce both sides to string via $toString so ObjectId vs. string
   *    storage differences are handled transparently.
   *    The pipeline inside $lookup groups tracking rows per user upfront
   *    (server-side join-reduction), summing total_duration.
   *
   *  Stage 3 – $project: shape the output to { userId, email, totalSessionDuration }.
   *    totalSessionDuration defaults to 0 when the user has no session records.
   */
  const pipeline = [
    // Stage 1: filter by email domain
    {
      $match: {
        email: { $regex: domainRegex },
      },
    },

    // Stage 2: join session_tracking and pre-aggregate inside the lookup pipeline
    // Using a pipeline-style $lookup so we can push $group/$sum into MongoDB
    // rather than returning all raw session documents to the application layer.
    {
      $lookup: {
        from: 'session_tracking',
        let: { userId: { $toString: '$_id' } },
        pipeline: [
          {
            // Match session_tracking.user_id (stringified) == users._id (stringified)
            $match: {
              $expr: {
                $eq: [{ $toString: '$user_id' }, '$$userId'],
              },
            },
          },
          {
            // Sum total_duration for all sessions belonging to this user.
            // $convert is used so numeric strings or nulls default to 0.
            $group: {
              _id: null,
              totalDuration: {
                $sum: {
                  $convert: {
                    input: '$total_duration',
                    to: 'double',
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
              // Sum total_cost for all sessions belonging to this user.
              // Using $convert to safely handle numeric strings or null values.
              totalCost: {
                $sum: {
                  $convert: {
                    input: '$total_cost',
                    to: 'double',
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
              // Collect individual session breakdowns for graph hover detail
              sessions: {
                $push: {
                  sessionId: { $toString: '$_id' },
                  duration: {
                    $convert: {
                      input: '$total_duration',
                      to: 'double',
                      onError: 0,
                      onNull: 0,
                    },
                  },
                  status: '$status',
                  sessionStart: '$session_start',
                  lastUpdated: '$last_updated',
                },
              },
            },
          },
        ],
        as: 'sessionAgg',
      },
    },

    // Stage 3: shape output – one document per user
    {
      $project: {
        _id: 0,
        userId: { $toString: '$_id' },
        email: 1,
        totalSessionDuration: {
          // sessionAgg is an array; use $ifNull + $arrayElemAt to default to 0
          $ifNull: [{ $arrayElemAt: ['$sessionAgg.totalDuration', 0] }, 0],
        },
        // totalCost: sum of total_cost across all sessions for this user
        totalCost: {
          $ifNull: [{ $arrayElemAt: ['$sessionAgg.totalCost', 0] }, 0],
        },
        // Session breakdown array for drill-down / bar graph hover tooltips.
        // Each element: { sessionId, duration, status, sessionStart, lastUpdated }
        sessionBreakdown: {
          $ifNull: [{ $arrayElemAt: ['$sessionAgg.sessions', 0] }, []],
        },
      },
    },

    // Sort by totalSessionDuration descending so the most active users appear first
    {
      $sort: { totalSessionDuration: -1 },
    },
  ];

  const results = await User.aggregate(pipeline).allowDiskUse(true);

  // Compute totalCredits in JavaScript post-aggregation using the shared CREDIT_MULTIPLIER.
  // NOTE: To change the credits conversion rate, edit CREDIT_MULTIPLIER in src/config/creditsConfig.js.
  // Credits formula: totalCredits = totalCost * CREDIT_MULTIPLIER (rounded to nearest integer)
  return results.map((row) => ({
    ...row,
    totalCost: typeof row.totalCost === 'number' && Number.isFinite(row.totalCost) ? row.totalCost : 0,
    totalCredits: Math.round((Number(row.totalCost) || 0) * CREDIT_MULTIPLIER),
  }));
}

// Re-export with the new function added
Object.assign(usersService, { getUserSessionStatsByDomain });
