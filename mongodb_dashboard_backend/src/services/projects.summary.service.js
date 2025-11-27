'use strict';

const SessionTracking = require('../models/sessionTracking.model');
let User = null;
try { User = require('../models/user.model'); } catch {}

/**
 * Build $match for tenant and optional time range over multiple fields.
 * Applies OR across [last_updated, timestamp, session_start] for time filtering if provided.
 */
function buildMatch({ tenantId, fromDate, toDate }) {
  const match = { tenant_id: tenantId };
  const timeClauses = [];
  if (fromDate || toDate) {
    const range = {};
    if (fromDate instanceof Date && !Number.isNaN(fromDate.getTime())) range.$gte = fromDate;
    if (toDate instanceof Date && !Number.isNaN(toDate.getTime())) range.$lte = toDate;

    if (Object.keys(range).length > 0) {
      timeClauses.push({ last_updated: range }, { timestamp: range }, { session_start: range });
    }
  }
  if (timeClauses.length > 0) {
    return { $and: [match, { $or: timeClauses }] };
  }
  return match;
}

/**
 * PUBLIC_INTERFACE
 * aggregateProjectSummariesByUser
 * Groups session tracking by user -> distinct project count and last activity.
 * Returns array sorted by projects_count desc then user_id asc.
 */
async function aggregateProjectSummariesByUser({ tenantId, fromDate, toDate }) {
  const match = buildMatch({ tenantId, fromDate, toDate });

  const pipeline = [
    { $match: match },
    // Collapse per user/project to get last activity
    {
      $group: {
        _id: { user_id: { $toString: '$user_id' }, project_id: '$project_id' },
        last_activity: {
          $max: {
            $ifNull: [
              '$last_updated',
              { $ifNull: ['$timestamp', '$session_start'] },
            ],
          },
        },
      },
    },
    // Now group per user to count distinct projects and get max last activity
    {
      $group: {
        _id: '$_id.user_id',
        projects_count: { $sum: { $cond: [{ $gt: ['$_id.project_id', null] }, 1, 0] } },
        last_activity: { $max: '$last_activity' },
      },
    },
    {
      $project: {
        _id: 0,
        user_id: '$_id',
        projects_count: 1,
        last_activity: 1,
      },
    },
    { $sort: { projects_count: -1, user_id: 1 } },
  ];

  let items = [];
  try {
    items = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
  } catch (err) {
    try { console.error('[projects.summary.service] aggregateProjectSummariesByUser error:', err?.message || err); } catch {}
    return [];
  }

  // Normalize last_activity to ISO strings
  return items.map(it => ({
    user_id: String(it.user_id || ''),
    projects_count: Number(it.projects_count || 0),
    last_activity: it.last_activity ? new Date(it.last_activity).toISOString() : null,
  }));
}

/**
 * PUBLIC_INTERFACE
 * aggregateProjectSummariesByDepartment
 * Joins session_tracking -> users on user_id to derive department.
 * Returns department-level distinct projects_count, users_count, last_activity.
 */
async function aggregateProjectSummariesByDepartment({ tenantId, fromDate, toDate }) {
  const match = buildMatch({ tenantId, fromDate, toDate });

  // If User model is not available, gracefully return empty array
  if (!User) {
    return [];
  }

  const pipeline = [
    { $match: match },
    // Normalize user_id to string for join consistency
    { $addFields: { user_id_str: { $toString: '$user_id' } } },
    // Join users to fetch department field (supports variations)
    {
      $lookup: {
        from: User.collection.name,
        let: { uid: '$user_id_str' },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$uid'] } } },
          { $project: { department: 1, dept: 1, team: 1, org_unit: 1 } },
        ],
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    // Pick department from multiple possible fields
    {
      $addFields: {
        dept_name: {
          $ifNull: [
            '$user.department',
            { $ifNull: ['$user.dept', { $ifNull: ['$user.team', '$user.org_unit'] }] },
          ],
        },
      },
    },
    // If no department, label as 'Unassigned'
    {
      $addFields: {
        dept_bucket: { $ifNull: ['$dept_name', 'Unassigned'] },
      },
    },
    // Collapse per department and project to count distinct projects and track last activity
    {
      $group: {
        _id: { dept: '$dept_bucket', project_id: '$project_id', user_id: '$user_id_str' },
        last_activity: {
          $max: {
            $ifNull: [
              '$last_updated',
              { $ifNull: ['$timestamp', '$session_start'] },
            ],
          },
        },
      },
    },
    // Group per department to compute metrics
    {
      $group: {
        _id: '$_id.dept',
        projects_set: { $addToSet: '$_id.project_id' },
        users_set: { $addToSet: '$_id.user_id' },
        last_activity: { $max: '$last_activity' },
      },
    },
    {
      $project: {
        _id: 0,
        department: '$_id',
        projects_count: {
          $size: {
            $filter: {
              input: '$projects_set',
              as: 'pid',
              cond: { $gt: ['$$pid', null] },
            },
          },
        },
        users_count: {
          $size: {
            $filter: {
              input: '$users_set',
              as: 'uid',
              cond: { $gt: ['$$uid', null] },
            },
          },
        },
        last_activity: 1,
      },
    },
    { $sort: { projects_count: -1, users_count: -1, department: 1 } },
  ];

  let items = [];
  try {
    items = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
  } catch (err) {
    try { console.error('[projects.summary.service] aggregateProjectSummariesByDepartment error:', err?.message || err); } catch {}
    return [];
  }

  return items.map(it => ({
    department: String(it.department || 'Unassigned'),
    projects_count: Number(it.projects_count || 0),
    users_count: Number(it.users_count || 0),
    last_activity: it.last_activity ? new Date(it.last_activity).toISOString() : null,
  }));
}

module.exports = {
  aggregateProjectSummariesByUser,
  aggregateProjectSummariesByDepartment,
};
