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
 *  2. $lookup joins session_tracking by users._id = session_tracking.user_id,
 *     with optional date range filtering applied inside the $lookup sub-pipeline
 *     using session_tracking.session_start as the canonical date field,
 *     so only sessions within the requested window contribute to totals.
 *  3. $project shapes one output row per user document (preserving the original
 *     509-user count behavior — one row per user document, not per unique email).
 *     organizationId is captured directly from the user document in this stage.
 *  4. $sort: descending by totalSessionDuration.
 *
 * Design decision: We intentionally do NOT group by email here. Grouping by email
 * would consolidate multi-org users and reduce the result count (e.g. 509 → 382).
 * The previous implementation returned one row per user document and the user has
 * verified 509 as the correct count via direct DB inspection.
 *
 * All aggregation logic is pushed entirely to MongoDB (no in-process join/merge).
 * Date filtering is applied at the DB level inside the $lookup sub-pipeline using
 * session_tracking.session_start as the primary filter field, falling back to
 * last_updated for older records that do not have a session_start value.
 *
 * @param {string} domain  Email domain to filter by (e.g. "davinci.com"). Required.
 * @param {object} [options]  Optional parameters for date range filtering.
 * @param {string|null} [options.range]  Preset range: 'last7' (default), 'last14', 'lastMonth', 'all'.
 *   'all' returns the full dataset with no date filter (preserves previous all-data behavior).
 * @param {string|null} [options.startDate]  Custom start date (ISO or YYYY-MM-DD).
 *   If provided together with endDate, overrides the preset range.
 * @param {string|null} [options.endDate]  Custom end date (ISO or YYYY-MM-DD).
 *   If provided together with startDate, overrides the preset range.
 * @returns {Promise<Array<{
 *   userId: string,
 *   email: string,
 *   organizationId: string,
 *   totalSessionDuration: number,
 *   totalCost: number,
 *   totalCredits: number,
 *   sessionBreakdown: Array
 * }>>}
 */
// NOTE: To change the credits multiplier, edit CREDIT_MULTIPLIER in src/config/creditsConfig.js
async function getUserSessionStatsByDomain(domain, { range = 'last7', startDate = null, endDate = null } = {}) {
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
   * Compute the date filter window for session_tracking records.
   * Priority:
   *  1. If both startDate and endDate are provided, use custom range (overrides preset).
   *  2. If range is provided (last7, last14, lastMonth), compute relative window from now.
   *  3. If range is 'all' or unrecognized, no date filter is applied (full dataset).
   *
   * The primary date field used for filtering is session_start, which is the canonical
   * activity timestamp in the session_tracking collection (sample value:
   * "2025-09-01T08:12:48.967+00:00"). Falls back to last_updated when session_start
   * is missing or null in older records.
   *
   * @returns {{ $gte?: Date, $lte?: Date } | null}
   */
  function computeDateFilter() {
    // Custom range takes priority when both bounds are provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        // Extend end date to the very end of the day in UTC (23:59:59.999)
        // so users are not surprised when their "endDate" is exclusive.
        end.setUTCHours(23, 59, 59, 999);
        return { $gte: start, $lte: end };
      }
    }

    // Preset ranges: computed relative to "now" at query time
    const now = new Date();

    if (range === 'last7') {
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - 7);
      start.setUTCHours(0, 0, 0, 0);
      return { $gte: start, $lte: now };
    }

    if (range === 'last14') {
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - 14);
      start.setUTCHours(0, 0, 0, 0);
      return { $gte: start, $lte: now };
    }

    if (range === 'lastMonth') {
      const start = new Date(now);
      start.setUTCMonth(start.getUTCMonth() - 1);
      start.setUTCHours(0, 0, 0, 0);
      return { $gte: start, $lte: now };
    }

    // 'all' or any unrecognized value: no date filter (full dataset).
    // This preserves the previous "All Data" behavior where all sessions are included.
    return null;
  }

  const dateFilter = computeDateFilter();

  /**
   * Build the $match stage to be used inside the $lookup sub-pipeline.
   *
   * When dateFilter is present, adds a date range condition using session_start as the
   * primary field (the canonical activity timestamp in session_tracking). Falls back to
   * last_updated for records where session_start is missing or null so that older
   * documents are still included within the requested window.
   *
   * When dateFilter is null (range='all'), only matches by user_id — this is the
   * "All Data" path that preserves the previous full-dataset behavior.
   *
   * BUG-FIX NOTE:
   * The previous implementation used plain query operators ({ session_start: { $gte, $lte } })
   * inside the $lookup sub-pipeline. This silently returns zero matches when session_start
   * (or last_updated) is stored as an ISO string rather than a BSON Date, because MongoDB
   * does not perform cross-type comparisons — Date objects will not match string fields.
   *
   * The fix uses $expr throughout the $match stage and normalises date fields to BSON Date
   * using $convert (to: 'date') before comparing. $convert handles both Date→Date (no-op)
   * and ISO-string→Date transparently, with onError: null so malformed values are safely
   * excluded rather than causing aggregation errors.
   *
   * @returns {object} MongoDB $match pipeline stage
   */
  function buildLookupMatchStage() {
    // User-identity expression: coerce both sides to string to handle ObjectId vs. string
    // storage differences in user_id transparently.
    const userIdExpr = { $eq: [{ $toString: '$user_id' }, '$$userId'] };

    if (!dateFilter) {
      // No date filtering — return ALL sessions for the user (range='all' behavior).
      // This preserves the previous implementation's full-dataset aggregation.
      return { $match: { $expr: userIdExpr } };
    }

    // -------------------------------------------------------------------
    // Date range filtering — type-agnostic via $convert(to:'date')
    // -------------------------------------------------------------------
    //
    // session_start and last_updated may be stored as BSON Date objects OR as
    // ISO-format strings, depending on the data source / ingest path.
    // Inside a $lookup sub-pipeline executed from User.aggregate(), Mongoose
    // schema coercion does NOT apply — the pipeline runs against the raw
    // collection. A plain { session_start: { $gte: <Date> } } query will
    // silently match zero documents when the stored value is a string, because
    // MongoDB is strictly typed in comparisons.
    //
    // $convert with to:'date':
    //   - Date value  → returned as-is (no-op)
    //   - ISO string  → parsed to BSON Date
    //   - null/missing → returns null (onNull: null)
    //   - unparseable  → returns null (onError: null)
    // Null values will never satisfy $gte/$lte, so they are safely excluded.

    /**
     * Wrap a field reference in $convert so it becomes a comparable BSON Date
     * regardless of whether the raw stored value is a Date or an ISO string.
     *
     * @param {string} fieldRef  e.g. '$session_start'
     * @returns {object} aggregation expression
     */
    const toDate = (fieldRef) => ({
      $convert: { input: fieldRef, to: 'date', onError: null, onNull: null },
    });

    /**
     * Build an $expr-compatible range condition for a single normalised date value.
     * Returns null when dateFilter has no bounds (edge case guard).
     *
     * @param {object} normalizedDateExpr  aggregation expression that yields a Date
     * @returns {object|null}
     */
    const makeDateRangeCond = (normalizedDateExpr) => {
      const parts = [];
      if (dateFilter.$gte) parts.push({ $gte: [normalizedDateExpr, dateFilter.$gte] });
      if (dateFilter.$lte) parts.push({ $lte: [normalizedDateExpr, dateFilter.$lte] });
      if (parts.length === 0) return null;
      return parts.length === 1 ? parts[0] : { $and: parts };
    };

    // Normalised date expressions for both candidate fields.
    const normalizedSessionStart = toDate('$session_start');
    const normalizedLastUpdated = toDate('$last_updated');

    // Build range conditions for each field.
    const sessionStartRangeCond = makeDateRangeCond(normalizedSessionStart);
    const lastUpdatedRangeCond = makeDateRangeCond(normalizedLastUpdated);

    // Edge case: no range bounds at all — fall back to user-match only.
    if (!sessionStartRangeCond && !lastUpdatedRangeCond) {
      return { $match: { $expr: userIdExpr } };
    }

    // Strategy:
    //  1. If session_start converts to a non-null Date, use it for the range check.
    //  2. Otherwise (session_start is absent, null, or not a date/string), use last_updated.
    //
    // $convert returns null when the input is missing, null, or unparseable, so we can
    // use { $ifNull: [normalizedSessionStart, normalizedLastUpdated] } to select the
    // best available date field before applying the range comparison. This is simpler
    // and more efficient than building a two-branch $or.
    const effectiveDate = {
      $ifNull: [normalizedSessionStart, normalizedLastUpdated],
    };

    const effectiveDateRangeCond = makeDateRangeCond(effectiveDate);

    // Safety: if still null (shouldn't happen given the guard above), use user-match only.
    if (!effectiveDateRangeCond) {
      return { $match: { $expr: userIdExpr } };
    }

    // Combine user-identity and date-range checks in a single $expr stage.
    // Using $expr for both conditions avoids mixing query operators with aggregation
    // expressions, which can cause unexpected behaviour inside $lookup sub-pipelines.
    return {
      $match: {
        $expr: {
          $and: [
            // User identity
            userIdExpr,
            // Date range: type-agnostic via $convert normalisation
            effectiveDateRangeCond,
          ],
        },
      },
    };
  }

  /**
   * Aggregation pipeline:
   *
   *  Stage 1 – $match: filter users collection by email domain using a case-insensitive
   *    regex anchored to /@<domain>$/.
   *
   *  Stage 2 – $lookup: left-outer join session_tracking on:
   *    users._id (coerced to string) == session_tracking.user_id (coerced to string)
   *    We coerce both sides to string via $toString so ObjectId vs. string storage
   *    differences are handled transparently.
   *    The pipeline inside $lookup filters by date range on session_start FIRST,
   *    then groups tracking rows per user (server-side join-reduction), summing
   *    total_duration and total_cost.
   *
   *  Stage 3 – $project: shape output — ONE DOCUMENT PER USER DOCUMENT.
   *    This is intentional: we do NOT group by email here because doing so would
   *    reduce the result count (e.g. 509 user docs → 382 unique emails). The
   *    previous implementation and user expectations require one row per user doc.
   *    organizationId is captured directly from the user document using a fallback
   *    chain: organization_id → organizationId → tenant_id → tenantId.
   *
   *  Stage 4 – $sort: descending by totalSessionDuration.
   */
  const pipeline = [
    // Stage 1: filter users by email domain (case-insensitive)
    {
      $match: {
        email: { $regex: domainRegex },
      },
    },

    // Stage 2: join session_tracking and pre-aggregate inside the lookup pipeline.
    // Using a pipeline-style $lookup so we can push $match/$group/$sum into MongoDB
    // rather than returning all raw session documents to the application layer.
    // The date range filter on session_start is applied INSIDE the sub-pipeline for
    // both correctness and performance.
    {
      $lookup: {
        from: 'session_tracking',
        let: { userId: { $toString: '$_id' } },
        pipeline: [
          // Apply user match + date range filter at the beginning of the sub-pipeline.
          // When range='all', this is a simple user_id match (no date restriction).
          buildLookupMatchStage(),
          {
            // Group: sum durations, costs, and collect session breakdowns for this user.
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
              // Sum total_cost for all matching sessions belonging to this user.
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
              // Count the number of matched session documents for this user.
              sessionCount: { $sum: 1 },
              // Collect individual session breakdowns for graph hover detail.
              // Each element: { sessionId, duration, status, sessionStart, lastUpdated }
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

    // Stage 3: shape output — ONE DOCUMENT PER USER DOCUMENT.
    //
    // IMPORTANT: We do NOT add a $group-by-email stage here. The previous implementation
    // returned one row per user document (509 users for the domain). Adding an email-group
    // stage reduces the count to unique emails (382), which differs from what the user
    // verified in the database. Preserving the one-row-per-user-document behavior is
    // the correct approach.
    //
    // organizationId is captured directly from the user document using a fallback chain
    // across common field name variants: organization_id → organizationId → tenant_id → tenantId.
    {
      $project: {
        _id: 0,
        userId: { $toString: '$_id' },
        email: 1,
        // organizationId: single value from this user document (not consolidated across docs)
        organizationId: {
          $ifNull: [
            '$organization_id',
            { $ifNull: ['$organizationId', { $ifNull: ['$tenant_id', { $ifNull: ['$tenantId', ''] }] }] },
          ],
        },
        // totalSessionDuration: sum of total_duration across all matching session documents.
        // Defaults to 0 when sessionAgg is empty (user has no sessions in the requested range).
        totalSessionDuration: {
          $ifNull: [{ $arrayElemAt: ['$sessionAgg.totalDuration', 0] }, 0],
        },
        // totalCost: sum of total_cost across all matching sessions.
        totalCost: {
          $ifNull: [{ $arrayElemAt: ['$sessionAgg.totalCost', 0] }, 0],
        },
        // Session breakdown array for drill-down / bar graph hover tooltips.
        sessionBreakdown: {
          $ifNull: [{ $arrayElemAt: ['$sessionAgg.sessions', 0] }, []],
        },
      },
    },

    // Stage 4: Sort by totalSessionDuration descending so the most active users appear first.
    {
      $sort: { totalSessionDuration: -1 },
    },
  ];

  const results = await User.aggregate(pipeline).allowDiskUse(true);

  // Compute totalCredits in JavaScript post-aggregation using the shared CREDIT_MULTIPLIER.
  // NOTE: To change the credits conversion rate, edit CREDIT_MULTIPLIER in src/config/creditsConfig.js.
  // Credits formula: totalCredits = totalCost * CREDIT_MULTIPLIER (rounded to nearest integer)
  return results.map((row) => {
    const safeCost = typeof row.totalCost === 'number' && Number.isFinite(row.totalCost) ? row.totalCost : 0;
    // Normalize organizationId to a non-null string
    const organizationId = row.organizationId !== null && row.organizationId !== undefined
      ? String(row.organizationId).trim()
      : '';

    return {
      // Spread existing fields (userId, email, totalSessionDuration, totalCost, sessionBreakdown, organizationId)
      ...row,
      organizationId,
      totalCost: safeCost,
      totalCredits: Math.round((Number(safeCost) || 0) * CREDIT_MULTIPLIER),
    };
  });
}

// Re-export with the new function added
Object.assign(usersService, { getUserSessionStatsByDomain });
