'use strict';

/**
 * Service: Resolve project names by projectId using cross-collection lookups with caching.
 * Lookup order (short-circuiting):
 * 1) AppDeployments: names possibly in projectName, project_name, metadata.projectName
 *    and IDs in projectId, project_id, metadata.projectId
 * 2) Projects collection: name/title/displayName
 * 3) SessionTracking: projectName/project_name, session_data.project_name
 * 4) Costs/Tenants/Users (if available in models) - last resort
 *
 * Exports:
 *   - resolveProjectName(projectId, options?)
 *   - resolveProjectNames(projectIds, options?)
 *
 * Options:
 *   { ttlMs?: number } // override default TTL
 */

const AppDeployment = require('../models/appDeployments.model');
const Project = require('../models/project.model');
const SessionTracking = require('../models/sessionTracking.model');
let LLMCost = null;
let Tenant = null;
let User = null;

try {
  // Optional models
  LLMCost = require('../models/llmCosts.model');
} catch {}
try {
  Tenant = require('../models/tenant.model');
} catch {}
try {
  User = require('../models/user.model');
} catch {}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
// In-memory cache Map: key -> { name: string|null, expiresAt: number }
const cache = new Map();

/**
 * Get from cache if available and not expired
 */
function getCached(projectId) {
  const entry = cache.get(projectId);
  const now = Date.now();
  if (entry && entry.expiresAt > now) {
    return entry.name;
  }
  if (entry) {
    cache.delete(projectId);
  }
  return undefined;
}

/**
 * Set cache with a TTL
 */
function setCached(projectId, name, ttlMs) {
  const expiresAt = Date.now() + (typeof ttlMs === 'number' ? ttlMs : DEFAULT_TTL_MS);
  cache.set(projectId, { name, expiresAt });
}

/**
 * Internal: build case-insensitive query to match project id across possible fields.
 */
function buildProjectIdOrQuery(projectId) {
  // Normalize as string; do not throw if falsy
  const id = typeof projectId === 'string' ? projectId : String(projectId || '').trim();
  if (!id) {return null;}
  return {
    $or: [
      { projectId: id },
      { project_id: id },
      { 'metadata.projectId': id },
      { 'project.id': id },
    ],
  };
}

/**
 * Internal: candidate name fields by precedence for a given collection doc.
 */
function pickNameFromDeployment(doc) {
  return (
    doc?.projectName ||
    doc?.project_name ||
    doc?.metadata?.projectName ||
    doc?.project?.name ||
    null
  );
}
function pickNameFromProject(doc) {
  return doc?.name || doc?.title || doc?.displayName || null;
}
function pickNameFromSession(doc) {
  return doc?.projectName || doc?.project_name || doc?.session_data?.project_name || null;
}
function pickNameFromCost(doc) {
  return doc?.project_name || doc?.projectName || null;
}
function pickNameFromTenant(doc) {
  return doc?.project_name || doc?.name || doc?.title || null;
}
function pickNameFromUser(doc) {
  return doc?.project_name || doc?.name || null;
}

/**
 * Internal: try collection queries in order until name is found.
 */
async function lookupProjectName(projectId) {
  const pidQuery = buildProjectIdOrQuery(projectId);
  if (!pidQuery) {return null;}

  // 1) AppDeployments
  try {
    const dep = await AppDeployment.findOne(pidQuery, {
      projectName: 1,
      project_name: 1,
      'metadata.projectName': 1,
      'project.name': 1,
    })
      .sort({ updatedAt: -1, updated_at: -1, createdAt: -1, created_at: -1 })
      .lean();
    const name = pickNameFromDeployment(dep);
    if (name) {return String(name);}
  } catch {
    // continue
  }

  // 2) Projects
  try {
    // Projects may store id equivalently in _id or id fields; attempt by id or by mapping fields
    const orQuery = {
      $or: [
        { _id: projectId },
        { id: projectId },
        { projectId },
        { project_id: projectId },
      ],
    };
    const proj = await Project.findOne(orQuery, { name: 1, title: 1, displayName: 1 }).lean();
    const name = pickNameFromProject(proj);
    if (name) {return String(name);}
  } catch {
    // continue
  }

  // 3) SessionTracking
  try {
    const ses = await SessionTracking.findOne(
      {
        $or: [
          { projectId },
          { project_id: projectId },
          { 'session_data.project_id': projectId },
          { 'session_data.projectId': projectId },
        ],
      },
      {
        projectName: 1,
        project_name: 1,
        'session_data.project_name': 1,
      }
    )
      .sort({ updatedAt: -1, timestamp: -1, ts: -1 })
      .lean();
    const name = pickNameFromSession(ses);
    if (name) {return String(name);}
  } catch {
    // continue
  }

  // 4) Last resort across optional collections (Costs/Tenants/Users)
  if (LLMCost) {
    try {
      const c = await LLMCost.findOne(
        {
          $or: [
            { projectId },
            { project_id: projectId },
            { project: projectId },
          ],
        },
        { project_name: 1, projectName: 1 }
      )
        .sort({ timestamp: -1 })
        .lean();
      const name = pickNameFromCost(c);
      if (name) {return String(name);}
    } catch {}
  }

  if (Tenant) {
    try {
      const t = await Tenant.findOne(
        { 'projects.project_id': projectId },
        { 'projects.$': 1 }
      ).lean();
      // If tenant stores projects array with names
      const proj = Array.isArray(t?.projects) && t.projects.length > 0 ? t.projects[0] : null;
      const name = proj?.project_name || proj?.name || null;
      if (name) {return String(name);}
    } catch {}
  }

  if (User) {
    try {
      const u = await User.findOne(
        { 'projects.project_id': projectId },
        { 'projects.$': 1, name: 1 }
      ).lean();
      const proj =
        Array.isArray(u?.projects) && u.projects.length > 0 ? u.projects[0] : null;
      const name = proj?.project_name || proj?.name || null;
      if (name) {return String(name);}
    } catch {}
  }

  return null;
}

// PUBLIC_INTERFACE
async function resolveProjectName(projectId, options = {}) {
  /** Resolve and return a project name string for the given projectId or null if not found.
   * Options: { ttlMs?: number } to override default cache TTL.
   */
  try {
    if (!projectId && projectId !== 0) {return null;}
    const pid = String(projectId).trim();
    if (!pid) {return null;}

    const cached = getCached(pid);
    if (cached !== undefined) {return cached;} // can be null or string

    const name = await lookupProjectName(pid);
    setCached(pid, name, options.ttlMs);
    return name;
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
async function resolveProjectNames(projectIds, options = {}) {
  /** Bulk resolve project names.
   * Accepts an array or iterable of ids. Returns a Map of projectId -> name|null.
   * If array is not provided, returns an empty Map.
   */
  const result = new Map();
  try {
    if (!Array.isArray(projectIds) || projectIds.length === 0) {return result;}

    // Normalize and de-duplicate ids
    const normalized = [];
    const seen = new Set();
    for (const id of projectIds) {
      if (id || id === 0) {
        const pid = String(id).trim();
        if (pid && !seen.has(pid)) {
          seen.add(pid);
          normalized.push(pid);
        }
      }
    }
    if (normalized.length === 0) {return result;}

    // First fill from cache
    const missing = [];
    for (const pid of normalized) {
      const cached = getCached(pid);
      if (cached !== undefined) {
        result.set(pid, cached);
      } else {
        missing.push(pid);
      }
    }

    // For remaining, lookup sequentially (could be optimized by batching with $in queries if schemas align)
    for (const pid of missing) {
      const name = await lookupProjectName(pid);
      setCached(pid, name, options.ttlMs);
      result.set(pid, name);
    }

    return result;
  } catch {
    return result;
  }
}

module.exports = {
  // PUBLIC INTERFACES
  resolveProjectName,
  resolveProjectNames,
};
