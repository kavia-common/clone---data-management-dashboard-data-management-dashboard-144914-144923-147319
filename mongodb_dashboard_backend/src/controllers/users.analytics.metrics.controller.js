'use strict';

/**
 * Users Analytics Metrics Controller
 *
 * Implements user analytics endpoints:
 * - GET /api/users/analytics/daily-active?days=30&start_date&end_date&department&organization_id
 * - GET /api/users/analytics/by-department?windowDays=14&start_date&end_date&department&organization_id
 * - GET /api/users/analytics/active-vs-inactive?windowDays=14&start_date&end_date&department&organization_id
 * - GET /api/users/analytics/top-active?limit=10&windowDays=30&start_date&end_date&department&organization_id
 * - GET /api/users/analytics/summary?start_date&end_date&department&organization_id
 *
 * Uses users collection fields: updated_at, created_at, department, organization_id, status, has_accepted_terms.
 * All date responses are ISO strings.
 */

const { getDb } = require('../config/db');

/**
 * Helpers
 */
const parsePositiveInt = (val, def) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

const now = () => new Date();

/**
 * Parse optional ISO date strings. Returns { start, end, error }
 * - If both provided, validates start <= end.
 */
function parseDateRange({ startStr, endStr }) {
  const start = startStr ? new Date(startStr) : null;
  const end = endStr ? new Date(endStr) : null;
  if (startStr && Number.isNaN(start?.getTime())) return { error: 'Invalid start_date' };
  if (endStr && Number.isNaN(end?.getTime())) return { error: 'Invalid end_date' };
  if (start && end && end < start) return { error: 'end_date must not be earlier than start_date' };
  return { start, end, error: null };
}

/**
 * Build an updated_at range $match object from start and end.
 */
function buildUpdatedAtMatch(start, end) {
  if (!start && !end) return undefined;
  const cond = {};
  if (start) cond.$gte = start;
  if (end) cond.$lte = end;
  return { updated_at: cond };
}

/**
 * Build created_at match for new user calculations
 */
function buildCreatedAtMatch(start, end) {
  if (!start && !end) return undefined;
  const cond = {};
  if (start) cond.$gte = start;
  if (end) cond.$lte = end;
  return { created_at: cond };
}

/**
 * Append optional organization_id and department filters to a match object.
 */
function applyOrgDeptFilters(match, { organization_id, department }) {
  if (organization_id) match.organization_id = String(organization_id);
  if (department) match.department = String(department);
  return match;
}

/**
 * Returns a date at UTC midnight for the provided date.
 */
const toUtcMidnight = (d) => {
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
};

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/daily-active?days=30
 * Returns array of { date: YYYY-MM-DD, activeCount } for last N days based on updated_at activity.
 */
async function dailyActive(req, res, next) {
  try {
    // Defaults: last 30 days if no start/end provided
    const days = parsePositiveInt(req.query.days, 30);
    const { start_date: startStr, end_date: endStr, organization_id, department } = req.query || {};
    const parsed = parseDateRange({ startStr, endStr });

    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const db = await getDb();
    const users = db.collection('users');

    const defaultEnd = now();
    const defaultStart = new Date(defaultEnd.getTime() - days * 24 * 60 * 60 * 1000);

    const end = parsed.end || defaultEnd;
    const start = parsed.start || defaultStart;

    // Aggregate by day on updated_at within the range, with org/department filters
    const baseMatch = applyOrgDeptFilters(
      { updated_at: { $gte: start, $lte: end } },
      { organization_id, department }
    );

    const pipeline = [
      {
        $match: baseMatch,
      },
      {
        $group: {
          _id: {
            y: { $year: { date: '$updated_at' } },
            m: { $month: { date: '$updated_at' } },
            d: { $dayOfMonth: { date: '$updated_at' } },
          },
          activeCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          dateObj: {
            $dateFromParts: {
              'year': '$_id.y',
              'month': '$_id.m',
              'day': '$_id.d',
            },
          },
          activeCount: 1,
        },
      },
      { $sort: { dateObj: 1 } },
    ];

    const rows = await users.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Fill gaps for days with zero activity
    const map = new Map(rows.map(r => [toUtcMidnight(r.dateObj).toISOString().slice(0, 10), r.activeCount]));
    const filled = [];
    let cursor = toUtcMidnight(start);
    const endMid = toUtcMidnight(end);
    while (cursor <= endMid) {
      const key = cursor.toISOString().slice(0, 10);
      filled.push({ date: key, activeCount: map.get(key) || 0 });
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }

    res.json(filled);
  } catch (err) {
    next(err);
  }
}

/**
 * Determine "active window" start
 */
function windowStart(days) {
  return new Date(now().getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/by-department?windowDays=14
 * Returns [{ department, activeCount }] for users active in the recent window.
 */
async function byDepartment(req, res, next) {
  try {
    // Default: last 14 days unless start/end provided
    const windowDays = parsePositiveInt(req.query.windowDays, 14);
    const { start_date: startStr, end_date: endStr, department, organization_id } = req.query || {};
    const parsed = parseDateRange({ startStr, endStr });
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const db = await getDb();
    const users = db.collection('users');

    const defaultEnd = now();
    const defaultStart = new Date(defaultEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const end = parsed.end || defaultEnd;
    const start = parsed.start || defaultStart;

    const match = applyOrgDeptFilters({ updated_at: { $gte: start, $lte: end } }, { organization_id, department });

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$department', 'Unknown'] },
          activeCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          department: '$_id',
          activeCount: 1,
        },
      },
      { $sort: { activeCount: -1, department: 1 } },
    ];

    const items = await users.aggregate(pipeline, { allowDiskUse: true }).toArray();
    res.json(items);
  } catch (err) {
    next(err);
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/active-vs-inactive?windowDays=14
 * Returns { active, inactive }
 * - active: users with updated_at within windowDays OR status explicitly "active"
 * - inactive: users outside that window AND not explicitly active status
 */
async function activeVsInactive(req, res, next) {
  try {
    const windowDays = parsePositiveInt(req.query.windowDays, 14);
    const { start_date: startStr, end_date: endStr, organization_id, department } = req.query || {};
    const parsed = parseDateRange({ startStr, endStr });
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const db = await getDb();
    const users = db.collection('users');
    const defaultEnd = now();
    const defaultStart = new Date(defaultEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const end = parsed.end || defaultEnd;
    const start = parsed.start || defaultStart;

    const scopeMatch = applyOrgDeptFilters({}, { organization_id, department });

    // Compute totals in-scope (respecting org/department)
    const [
      totalCount,
      activeCountByUpdatedAt,
      activeStatusCount,
      overlap,
    ] = await Promise.all([
      users.countDocuments(scopeMatch),
      users.countDocuments({ ...scopeMatch, updated_at: { $gte: start, $lte: end } }),
      users.countDocuments({ ...scopeMatch, status: 'active' }),
      users.countDocuments({ ...scopeMatch, updated_at: { $gte: start, $lte: end }, status: 'active' }),
    ]);

    const active = activeCountByUpdatedAt + activeStatusCount - overlap;
    const inactive = Math.max(0, totalCount - active);

    res.json({ active, inactive });
  } catch (err) {
    next(err);
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/top-active?limit=10&windowDays=30
 * Returns top users by recent activity recency (updated_at) within window.
 * If multiple updates per user exist, we consider the most recent one via $group.
 */
async function topActive(req, res, next) {
  try {
    const limit = parsePositiveInt(req.query.limit, 10);
    const windowDays = parsePositiveInt(req.query.windowDays, 30);
    const { start_date: startStr, end_date: endStr, department, organization_id } = req.query || {};

    const parsed = parseDateRange({ startStr, endStr });
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const db = await getDb();
    const users = db.collection('users');

    const defaultEnd = now();
    const defaultStart = new Date(defaultEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const end = parsed.end || defaultEnd;
    const start = parsed.start || defaultStart;

    const match = applyOrgDeptFilters({ updated_at: { $gte: start, $lte: end } }, { organization_id, department });

    const pipeline = [
      { $match: match },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          department: 1,
          organization_id: 1,
          updated_at: 1,
        },
      },
      { $sort: { updated_at: -1 } },
      { $limit: limit },
      {
        $project: {
          user_id: { $toString: '$_id' },
          name: 1,
          email: 1,
          department: 1,
          organization_id: 1,
          last_active_at: '$updated_at',
        },
      },
    ];

    const items = await users.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Ensure ISO
    const normalized = items.map((u) => ({
      ...u,
      last_active_at: u.last_active_at ? new Date(u.last_active_at).toISOString() : null,
    }));

    res.json(normalized);
  } catch (err) {
    next(err);
  }
}

/**
 * Compute WAU and MAU values using updated_at against windows of 7 and 30 days.
 */
async function computeWAU_MAU(usersCol, scopeMatch = {}, refEnd = null) {
  const nowDt = refEnd || now();
  const wauStart = new Date(nowDt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const mauStart = new Date(nowDt.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [WAU, MAU] = await Promise.all([
    usersCol.countDocuments({ ...scopeMatch, updated_at: { $gte: wauStart, $lte: nowDt } }),
    usersCol.countDocuments({ ...scopeMatch, updated_at: { $gte: mauStart, $lte: nowDt } }),
  ]);

  return { WAU, MAU };
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/summary
 * Returns KPIs:
 * - totalActive: users with updated_at within last 14 days
 * - newUsersThisWeek: created_at within last 7 days
 * - inactive30Days: no updated_at in last 30 days OR status == 'inactive'
 * - compliancePct: has_accepted_terms true ratio
 * - WAU, MAU based on updated_at
 */
async function summary(req, res, next) {
  try {
    const { start_date: startStr, end_date: endStr, department, organization_id } = req.query || {};
    const parsed = parseDateRange({ startStr, endStr });
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const db = await getDb();
    const users = db.collection('users');

    // Reference end date for calculations; if end provided, use it; else now
    const refEnd = parsed.end || now();

    // Defaults (when start missing) keep same windows: activeWindow 14d, new users last 7d, inactive 30d windows
    const activeWindowStart = new Date(refEnd.getTime() - 14 * 24 * 60 * 60 * 1000);
    const newUsersStart = new Date(refEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
    const inactiveWindowStart = new Date(refEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

    // If start is provided, we still compute metrics relative to refEnd according to semantics:
    // - totalActive: updated_at within [max(start, refEnd-14d), refEnd] to keep "last 14d" semantics within provided window
    // - newUsersThisWeek: created_at within [max(start, refEnd-7d), refEnd]
    // - inactive30Days: users with updated_at < (refEnd-30d) or missing, but also respect org/department filters
    const scopeMatch = applyOrgDeptFilters({}, { organization_id, department });

    const activeMatch = {
      ...scopeMatch,
      updated_at: {
        $gte: parsed.start ? new Date(Math.max(parsed.start.getTime(), activeWindowStart.getTime())) : activeWindowStart,
        $lte: refEnd,
      },
    };

    const newUsersMatch = {
      ...scopeMatch,
      created_at: {
        $gte: parsed.start ? new Date(Math.max(parsed.start.getTime(), newUsersStart.getTime())) : newUsersStart,
        $lte: refEnd,
      },
    };

    const inactiveByWindowMatch = {
      ...scopeMatch,
      $or: [
        { updated_at: { $lt: inactiveWindowStart } },
        { updated_at: { $exists: false } },
      ],
    };

    const [
      totalUsers,
      totalActive,
      newUsersThisWeek,
      inactiveByWindow,
      explicitlyInactive,
      complianceTrue,
    ] = await Promise.all([
      users.countDocuments(scopeMatch),
      users.countDocuments(activeMatch),
      users.countDocuments(newUsersMatch),
      users.countDocuments(inactiveByWindowMatch),
      users.countDocuments({ ...scopeMatch, status: 'inactive' }),
      users.countDocuments({ ...scopeMatch, has_accepted_terms: true }),
    ]);

    const inactive30Days = Math.min(totalUsers, inactiveByWindow + explicitlyInactive);
    const compliancePct = totalUsers > 0 ? +(100 * (complianceTrue / totalUsers)).toFixed(2) : 0;

    const { WAU, MAU } = await computeWAU_MAU(users, scopeMatch, refEnd);

    res.json({
      totalActive,
      newUsersThisWeek,
      inactive30Days,
      compliancePct,
      WAU,
      MAU,
      generatedAt: refEnd.toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUBLIC_INTERFACE
 * Ensure indexes for performance (idempotent).
 * Creates indexes on updated_at, created_at, department, organization_id.
 */
async function ensureUsersAnalyticsIndexes() {
  const db = await getDb();
  const users = db.collection('users');

  await Promise.all([
    users.createIndex({ updated_at: -1 }, { name: 'users_updated_at_desc' }),
    users.createIndex({ created_at: -1 }, { name: 'users_created_at_desc' }),
    users.createIndex({ department: 1 }, { name: 'users_department_asc' }),
    users.createIndex({ organization_id: 1 }, { name: 'users_org_asc' }),
  ]);
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/filters/departments
 * Returns array of distinct department values (strings), excluding null/empty.
 */
async function getDistinctDepartments(req, res, next) {
  try {
    const db = await getDb();
    const users = db.collection('users');
    const values = await users.distinct('department', { department: { $exists: true, $ne: null, $ne: '' } });
    // Normalize to strings and sort
    const items = values
      .map((v) => (v == null ? null : String(v)))
      .filter((v) => v && v.trim() !== '')
      .sort((a, b) => a.localeCompare(b));
    res.json(items);
  } catch (err) {
    next(err);
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/filters/organizations
 * Returns array of distinct organization_id values (strings), excluding null/empty.
 */
async function getDistinctOrganizations(req, res, next) {
  try {
    const db = await getDb();
    const users = db.collection('users');
    const values = await users.distinct('organization_id', { organization_id: { $exists: true, $ne: null, $ne: '' } });
    const items = values
      .map((v) => (v == null ? null : String(v)))
      .filter((v) => v && v.trim() !== '')
      .sort((a, b) => a.localeCompare(b));
    res.json(items);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  dailyActive,
  byDepartment,
  activeVsInactive,
  topActive,
  summary,
  ensureUsersAnalyticsIndexes,
  getDistinctDepartments,
  getDistinctOrganizations,
};
