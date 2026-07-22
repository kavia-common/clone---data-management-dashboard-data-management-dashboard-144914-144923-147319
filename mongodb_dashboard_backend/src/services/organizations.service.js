'use strict';

/**
 * PUBLIC_INTERFACE
 * organizations.service.js
 *
 * Aggregation service backing the Organization feature (`/api/organizations/*`).
 *
 * Exports:
 *  - getTenantScopeForCaller(callerTenantId) — resolves whether the caller is a
 *    "domain admin" tenant and, if so, the full list of tenants sharing its domain.
 *  - getOrganizationUsersTable({...}) — unique-users-per-tenant table with session
 *    counts, distinct project counts, code files / docs generated totals, per-user
 *    credits (from session_tracking.total_cost), and comma-separated organization
 *    names when merging across tenants.
 *
 * All operations are strictly read-only.
 */

const mongoose = require('mongoose');
const { getDb } = require('../config/db');
const { getManagedDomain } = require('../config/domainAdmins');
const { usdToCredits } = require('../utils/credits');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * PUBLIC_INTERFACE
 * getTenantScopeForCaller
 * Resolves the set of tenants the caller is allowed to see in the Organization dropdown.
 *
 * @param {string} callerTenantId - tenant_id of the authenticated caller (from JWT/tenant scope).
 * @returns {Promise<{ isDomainAdmin: boolean, managedDomain: string|null, tenants: Array<{tenant_id: string, name: string}> }>}
 */
async function getTenantScopeForCaller(callerTenantId) {
  const db = getDb ? await getDb() : mongoose.connection.db;
  if (!db) throw new Error('Database not connected');

  const managedDomain = getManagedDomain(callerTenantId);

  if (managedDomain) {
    const orgs = await db
      .collection('organizations')
      .find({ domain: managedDomain })
      .project({ _id: 1, name: 1 })
      .sort({ name: 1 })
      .toArray();

    return {
      isDomainAdmin: true,
      managedDomain,
      tenants: orgs.map((o) => ({
        tenant_id: String(o._id),
        name: (o.name && String(o.name).trim()) || String(o._id),
      })),
    };
  }

  // Non-domain-admin: only the caller's own tenant is in scope.
  const ownOrg = await db.collection('organizations').findOne(
    { _id: String(callerTenantId) },
    { projection: { _id: 1, name: 1 } }
  );

  return {
    isDomainAdmin: false,
    managedDomain: null,
    tenants: [
      {
        tenant_id: String(callerTenantId),
        name: (ownOrg?.name && String(ownOrg.name).trim()) || String(callerTenantId),
      },
    ],
  };
}

/**
 * Builds the $match time-window clause shared with the rest of the app
 * (session_start / last_updated / timestamp — a session counts as "in range"
 * if ANY of these fields falls within [fromUtc, toUtc]).
 */
function buildTimeWindowOr(fromUtc, toUtc) {
  const range = {};
  if (fromUtc instanceof Date && !Number.isNaN(fromUtc.getTime())) range.$gte = fromUtc;
  if (toUtc instanceof Date && !Number.isNaN(toUtc.getTime())) range.$lte = toUtc;
  if (Object.keys(range).length === 0) return null;
  return [{ session_start: range }, { last_updated: range }, { timestamp: range }];
}

/**
 * Multi-condition lookup pipeline to resolve a canonical user name/email from the
 * `users` collection, matching by ObjectId, user_id, or stringified _id — mirrors
 * the pattern already used in dashboard.users.routes.js / tata.sessions.service.js.
 */
function buildUserLookupStages(localIdField) {
  return [
    {
      $lookup: {
        from: 'users',
        let: { uid: localIdField },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  {
                    $and: [
                      { $eq: [{ $type: '$_id' }, 'objectId'] },
                      {
                        $eq: [
                          '$_id',
                          { $convert: { input: '$$uid', to: 'objectId', onError: null, onNull: null } },
                        ],
                      },
                    ],
                  },
                  { $eq: ['$user_id', '$$uid'] },
                  { $eq: [{ $toString: '$_id' }, '$$uid'] },
                ],
              },
            },
          },
          {
            $project: {
              _id: 1,
              email: 1,
              name: 1,
              full_name: 1,
              fullName: 1,
              displayName: 1,
              display_name: 1,
              user_name: 1,
            },
          },
        ],
        as: 'userDoc',
      },
    },
    { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        resolvedName: {
          $ifNull: [
            '$userDoc.name',
            {
              $ifNull: [
                '$userDoc.full_name',
                {
                  $ifNull: [
                    '$userDoc.fullName',
                    { $ifNull: ['$userDoc.displayName', { $ifNull: ['$userDoc.display_name', '$userDoc.user_name'] }] },
                  ],
                },
              ],
            },
          ],
        },
        resolvedEmail: { $ifNull: ['$userDoc.email', null] },
      },
    },
  ];
}

/**
 * PUBLIC_INTERFACE
 * getOrganizationUsersTable
 * Runs the unique-users-per-tenant aggregation against session_tracking.
 *
 * @param {{
 *   effectiveTenantIds: string[],  // final, security-checked tenant scope for this request
 *   mergeAcrossTenants: boolean,   // true only for domain-admin "All Tenants" selection
 *   fromUtc: Date|null,
 *   toUtc: Date|null,
 * }} params
 * @returns {Promise<Array<{
 *   userId: string, name: string, email: string, organization: string,
 *   tenantIds: string[], sessions: number, projects: number,
 *   codeFiles: number, docsGenerated: number, credits: number,
 *   sessionBreakdown: Array<{ date: string, sessions: number, durationSec: number }>
 * }>>}
 */
async function getOrganizationUsersTable({ effectiveTenantIds, mergeAcrossTenants, fromUtc, toUtc }) {
  const db = getDb ? await getDb() : mongoose.connection.db;
  if (!db) throw new Error('Database not connected');

  const tenantIds = Array.isArray(effectiveTenantIds) ? effectiveTenantIds.filter(Boolean) : [];
  if (tenantIds.length === 0) return [];

  const timeOr = buildTimeWindowOr(fromUtc, toUtc);

  const matchAnd = [{ tenant_id: { $in: tenantIds } }];
  if (timeOr) matchAnd.push({ $or: timeOr });

  const groupId = mergeAcrossTenants
    ? '$userIdStr'
    : { userIdStr: '$userIdStr', tenant_id: '$tenant_id' };

  const pipeline = [
    { $match: { $and: matchAnd } },
    {
      $addFields: {
        userIdStr: { $toString: '$user_id' },
        // NOTE: a missing field compared via $eq to null evaluates to false (unlike find-query
        // semantics), so we must normalize with $ifNull first before checking for null/empty.
        sessionKey: {
          $toString: {
            $cond: [
              { $in: [{ $ifNull: ['$session_id', null] }, [null, '']] },
              '$_id',
              '$session_id',
            ],
          },
        },
        dayKey: {
          $cond: [
            { $ifNull: ['$session_start', false] },
            { $dateToString: { format: '%Y-%m-%d', date: '$session_start' } },
            null,
          ],
        },
        // Projects column: normalize project_id the same safe way as sessionKey above
        // (a missing/empty project_id becomes null so it never gets counted as a "real" project).
        projectIdStr: {
          $cond: [
            { $in: [{ $ifNull: ['$project_id', null] }, [null, '']] },
            null,
            { $toString: '$project_id' },
          ],
        },
      },
    },
    { $match: { userIdStr: { $ne: null, $ne: '' } } },
    {
      $group: {
        _id: groupId,
        sessionIds: { $addToSet: '$sessionKey' },
        totalDurationSec: { $sum: { $toDouble: { $ifNull: ['$total_duration', 0] } } },
        totalCostUsd: { $sum: { $toDouble: { $ifNull: ['$total_cost', 0] } } },
        // Code Files / Docs Generated columns: output_files_created and output_docs_generated
        // are recent additions to session_tracking, so only ~half of existing records carry
        // them — $ifNull to 0 means older sessions simply contribute nothing, rather than
        // breaking the sum.
        totalCodeFiles: { $sum: { $toDouble: { $ifNull: ['$output_files_created', 0] } } },
        totalDocsGenerated: { $sum: { $toDouble: { $ifNull: ['$output_docs_generated', 0] } } },
        tenantIdsSet: { $addToSet: '$tenant_id' },
        // Projects column: collect every distinct project_id this user's sessions touch,
        // e.g. 5 sessions on project 32 + 5 sessions on project 34 => 2 distinct projects.
        projectIdsSet: { $addToSet: '$projectIdStr' },
        emailFallback: { $first: '$User_name' },
        dailyPush: {
          $push: {
            day: '$dayKey',
            sessionKey: '$sessionKey',
            durationSec: { $toDouble: { $ifNull: ['$total_duration', 0] } },
          },
        },
      },
    },
    {
      $addFields: {
        totalSessions: {
          $size: {
            $filter: {
              input: '$sessionIds',
              as: 's',
              cond: { $and: [{ $ne: ['$$s', null] }, { $ne: ['$$s', ''] }] },
            },
          },
        },
        // Projects column: count of distinct, non-empty project_id values (see projectIdsSet above).
        totalProjects: {
          $size: {
            $filter: {
              input: '$projectIdsSet',
              as: 'p',
              cond: { $and: [{ $ne: ['$$p', null] }, { $ne: ['$$p', ''] }] },
            },
          },
        },
        userIdStr: { $cond: [{ $eq: [{ $type: '$_id' }, 'object'] }, '$_id.userIdStr', '$_id'] },
      },
    },
    ...buildUserLookupStages('$userIdStr'),
    {
      $lookup: {
        from: 'organizations',
        let: { tids: '$tenantIdsSet' },
        pipeline: [
          { $match: { $expr: { $in: ['$_id', '$$tids'] } } },
          { $project: { _id: 1, name: 1 } },
        ],
        as: 'orgDocs',
      },
    },
    {
      $addFields: {
        organizationNames: {
          $sortArray: {
            input: {
              $map: {
                input: '$orgDocs',
                as: 'o',
                in: { $ifNull: ['$$o.name', '$$o._id'] },
              },
            },
            sortBy: 1,
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        userId: '$userIdStr',
        name: { $ifNull: ['$resolvedName', ''] },
        email: { $ifNull: ['$resolvedEmail', '$emailFallback'] },
        organization: {
          $reduce: {
            input: '$organizationNames',
            initialValue: '',
            in: { $cond: [{ $eq: ['$$value', ''] }, '$$this', { $concat: ['$$value', ', ', '$$this'] }] },
          },
        },
        tenantIds: '$tenantIdsSet',
        sessions: '$totalSessions',
        projects: '$totalProjects',
        totalCostUsd: 1,
        codeFiles: '$totalCodeFiles',
        docsGenerated: '$totalDocsGenerated',
        dailyPush: 1,
      },
    },
    { $sort: { sessions: -1, name: 1 } },
  ];

  const rows = await db
    .collection('session_tracking')
    .aggregate(pipeline, { allowDiskUse: true })
    .toArray();

  return rows.map((r) => ({
    userId: String(r.userId || ''),
    name: r.name ? String(r.name) : '',
    email: r.email ? String(r.email) : '',
    organization: r.organization || '',
    tenantIds: Array.isArray(r.tenantIds) ? r.tenantIds.map(String) : [],
    sessions: Number(r.sessions || 0),
    projects: Number(r.projects || 0),
    codeFiles: Number(r.codeFiles || 0),
    docsGenerated: Number(r.docsGenerated || 0),
    credits: usdToCredits(r.totalCostUsd || 0),
    sessionBreakdown: buildSessionBreakdown(r.dailyPush),
  }));
}

/**
 * PUBLIC_INTERFACE
 * getPlatformUsageTable
 * Joins code-generation tasks from the caller's tenant database to session_tracking,
 * then aggregates one row per user (or user and tenant for an explicit tenant selection).
 * Every matching session_tracking document represents one session.
 */
async function getPlatformUsageTable({
  sourceTenantId,
  effectiveTenantIds,
  mergeAcrossTenants,
  executionTarget,
  fromUtc,
  toUtc,
}) {
  const db = getDb ? await getDb() : mongoose.connection.db;
  if (!db) {
    throw new Error('Database not connected');
  }

  const tenantIds = Array.isArray(effectiveTenantIds) ? effectiveTenantIds.filter(Boolean) : [];
  const tenantId = String(sourceTenantId || '').trim();
  const target = executionTarget === 'cloud' ? 'cloud' : 'local';
  if (!tenantId || tenantIds.length === 0) {
    return [];
  }

  // Tenant databases follow pre_prod_<tenant_id> by default. Deployments with a
  // different convention can provide a template such as "tenant_{tenantId}".
  const databaseTemplate =
    String(process.env.CODE_GEN_TASKS_DB_TEMPLATE || '').trim() || 'pre_prod_{tenantId}';
  const tenantDatabaseName = databaseTemplate.replace(/\{tenantId\}/g, tenantId);
  const mongoClient = mongoose.connection.getClient();
  const tasksCollection = mongoClient.db(tenantDatabaseName).collection('code_gen_tasks');

  let rawTaskIds;
  try {
    // MongoDB returns an empty result when either the tenant database or collection
    // does not exist. NamespaceNotFound is handled as an additional safeguard for
    // deployments that explicitly reject access to a missing namespace.
    rawTaskIds = await tasksCollection.distinct('_id', { execution_target: target });
  } catch (error) {
    if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') {
      return [];
    }
    throw error;
  }

  const taskIds = rawTaskIds.map(String).filter(Boolean);
  if (taskIds.length === 0) {
    return [];
  }

  const matchAnd = [
    { tenant_id: { $in: tenantIds } },
    { task_id: { $in: taskIds } },
  ];
  const timeOr = buildTimeWindowOr(fromUtc, toUtc);
  if (timeOr) {
    matchAnd.push({ $or: timeOr });
  }

  const groupId = mergeAcrossTenants
    ? '$userIdStr'
    : { userIdStr: '$userIdStr', tenant_id: '$tenant_id' };

  const pipeline = [
    { $match: { $and: matchAnd } },
    { $addFields: { userIdStr: { $toString: '$user_id' } } },
    { $match: { userIdStr: { $nin: [null, ''] } } },
    {
      $group: {
        _id: groupId,
        sessions: { $sum: 1 },
        totalCostUsd: { $sum: { $toDouble: { $ifNull: ['$total_cost', 0] } } },
        tenantIdsSet: { $addToSet: '$tenant_id' },
        nameFallback: { $first: '$User_name' },
      },
    },
    {
      $addFields: {
        userIdStr: { $cond: [{ $eq: [{ $type: '$_id' }, 'object'] }, '$_id.userIdStr', '$_id'] },
      },
    },
    ...buildUserLookupStages('$userIdStr'),
    {
      $lookup: {
        from: 'organizations',
        let: { tids: '$tenantIdsSet' },
        pipeline: [
          { $match: { $expr: { $in: ['$_id', '$$tids'] } } },
          { $project: { _id: 1, name: 1 } },
          { $sort: { name: 1 } },
        ],
        as: 'orgDocs',
      },
    },
    {
      $project: {
        _id: 0,
        userId: '$userIdStr',
        name: { $ifNull: ['$resolvedName', '$nameFallback'] },
        tenantIds: '$tenantIdsSet',
        organizationNames: {
          $map: {
            input: '$orgDocs',
            as: 'organization',
            in: { $ifNull: ['$$organization.name', '$$organization._id'] },
          },
        },
        sessions: 1,
        totalCostUsd: 1,
      },
    },
    { $sort: { sessions: -1, name: 1 } },
  ];

  const rows = await db
    .collection('session_tracking')
    .aggregate(pipeline, { allowDiskUse: true })
    .toArray();

  const platform = target === 'cloud' ? 'Cloud' : 'VSC Extension';
  return rows.map((row) => {
    const rowTenantIds = Array.isArray(row.tenantIds) ? row.tenantIds.map(String) : [];
    return {
      id: `${String(row.userId || '')}:${rowTenantIds.sort().join(',')}:${target}`,
      userId: String(row.userId || ''),
      name: row.name ? String(row.name) : '',
      organization: Array.isArray(row.organizationNames)
        ? row.organizationNames.filter(Boolean).join(', ')
        : '',
      tenantIds: rowTenantIds,
      platform,
      executionTarget: target,
      sessions: Number(row.sessions || 0),
      credits: usdToCredits(row.totalCostUsd || 0),
    };
  });
}

/**
 * Collapses the raw per-session daily push array into a compact, de-duplicated
 * per-day breakdown (date, session count, total duration) sorted by date ascending.
 * Used to render the hover tooltip on the Sessions column.
 */
function buildSessionBreakdown(dailyPush) {
  if (!Array.isArray(dailyPush) || dailyPush.length === 0) return [];

  const byDay = new Map();
  const seenSessionKeys = new Set();

  dailyPush.forEach((entry) => {
    const day = entry?.day || 'unknown';
    const key = String(entry?.sessionKey || '');
    // Avoid double counting a session if it somehow appears twice in the push array.
    const dedupeKey = `${day}::${key}`;
    if (key && seenSessionKeys.has(dedupeKey)) return;
    if (key) seenSessionKeys.add(dedupeKey);

    if (!byDay.has(day)) {
      byDay.set(day, { date: day, sessions: 0, durationSec: 0 });
    }
    const bucket = byDay.get(day);
    bucket.sessions += 1;
    bucket.durationSec += Number(entry?.durationSec || 0);
  });

  return Array.from(byDay.values())
    .filter((b) => b.date !== 'unknown')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * PUBLIC_INTERFACE
 * getUserSessionDetails
 * Per-session breakdown for a single user: project_id, session_name (from
 * session_data.session_name) and total_duration for every distinct session,
 * scoped to the same tenant/date window rules as getOrganizationUsersTable.
 *
 * This is intentionally a separate, on-demand call (used by the frontend only when a
 * user hovers over a row's session count) rather than being embedded in the main
 * table response, since most rows are never hovered and the per-session detail can
 * be comparatively large for heavy users.
 *
 * @param {{
 *   userId: string,                // the user_id to fetch session details for
 *   effectiveTenantIds: string[],  // final, security-checked tenant scope for this request
 *   fromUtc: Date|null,
 *   toUtc: Date|null,
 * }} params
 * @returns {Promise<Array<{
 *   sessionId: string, tenantId: string, projectId: string,
 *   sessionName: string, totalDurationSec: number, sessionStart: string|null
 * }>>}
 */
async function getUserSessionDetails({ userId, effectiveTenantIds, fromUtc, toUtc }) {
  const db = getDb ? await getDb() : mongoose.connection.db;
  if (!db) throw new Error('Database not connected');

  const tenantIds = Array.isArray(effectiveTenantIds) ? effectiveTenantIds.filter(Boolean) : [];
  const uid = String(userId || '').trim();
  if (tenantIds.length === 0 || !uid) return [];

  const timeOr = buildTimeWindowOr(fromUtc, toUtc);
  const matchAnd = [
    { tenant_id: { $in: tenantIds } },
    { $expr: { $eq: [{ $toString: '$user_id' }, uid] } },
  ];
  if (timeOr) matchAnd.push({ $or: timeOr });

  const pipeline = [
    { $match: { $and: matchAnd } },
    {
      $addFields: {
        // Same session-identity normalization used by getOrganizationUsersTable, so the
        // number of rows returned here always matches that table's "sessions" count.
        sessionKey: {
          $toString: {
            $cond: [
              { $in: [{ $ifNull: ['$session_id', null] }, [null, '']] },
              '$_id',
              '$session_id',
            ],
          },
        },
      },
    },
    { $sort: { session_start: 1 } },
    {
      // Collapse duplicate tracking rows for the same session down to one entry.
      $group: {
        _id: '$sessionKey',
        tenantId: { $first: '$tenant_id' },
        projectId: { $first: '$project_id' },
        sessionName: { $first: { $ifNull: ['$session_data.session_name', null] } },
        totalDurationSec: { $first: { $toDouble: { $ifNull: ['$total_duration', 0] } } },
        sessionStart: { $first: '$session_start' },
      },
    },
    { $sort: { sessionStart: -1 } },
    {
      $project: {
        _id: 0,
        sessionId: '$_id',
        tenantId: 1,
        projectId: { $ifNull: [{ $toString: '$projectId' }, ''] },
        sessionName: 1,
        totalDurationSec: 1,
        sessionStart: 1,
      },
    },
  ];

  const rows = await db
    .collection('session_tracking')
    .aggregate(pipeline, { allowDiskUse: true })
    .toArray();

  return rows.map((r) => ({
    sessionId: String(r.sessionId || ''),
    tenantId: r.tenantId ? String(r.tenantId) : '',
    projectId: r.projectId || '',
    sessionName: r.sessionName ? String(r.sessionName) : 'Untitled',
    totalDurationSec: Number(r.totalDurationSec || 0),
    sessionStart: r.sessionStart ? new Date(r.sessionStart).toISOString() : null,
  }));
}

module.exports = {
  getTenantScopeForCaller,
  getOrganizationUsersTable,
  getPlatformUsageTable,
  getUserSessionDetails,
  buildTimeWindowOr,
  MS_PER_DAY,
};
