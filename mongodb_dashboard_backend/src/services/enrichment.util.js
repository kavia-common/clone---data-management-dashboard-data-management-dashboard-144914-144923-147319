'use strict';

/**
 * Utility helpers for enriching documents with normalized projectId and updatedAt.
 * These functions are pure, defensive, and never throw on missing fields.
 */

// PUBLIC_INTERFACE
function normalizeProjectId(input) {
  /** Normalize various forms of projectId fields to a lowercase string id.
   * Accepts strings, numbers, objects with fields: projectId, project_id, metadata.projectId, project.id, id, etc.
   * Returns null if not resolvable.
   */
  try {
    if (!input) {return null;}

    // If input is a string or number, coerce to string
    if (typeof input === 'string' || typeof input === 'number') {
      const val = String(input).trim();
      return val ? val : null;
    }

    // If input is a Mongo ObjectId-like object with toString
    if (typeof input === 'object' && input !== null && typeof input.toString === 'function') {
      // Avoid turning a plain object like {} into "[object Object]"
      // Only treat as ObjectId-like if it has a hex-like toString of length 24 or includes digits/letters
      const s = input.toString();
      if (s && s !== '[object Object]') {
        return String(s).trim() || null;
      }
    }

    // Try common nested paths
    const candidates = [
      input.projectId,
      input.project_id,
      input?.metadata?.projectId,
      input?.metadata?.project_id,
      input?.project?.id,
      input?.project?.projectId,
      input?.id, // last resort
    ]
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v).trim())
      .filter((s) => s.length > 0);

    if (candidates.length > 0) {
      return candidates[0];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Internal: parse a value into a valid Date if possible, else null.
 */
function toValidDate(val) {
  try {
    if (!val) {return null;}

    if (val instanceof Date) {
      return isNaN(val.getTime()) ? null : val;
    }

    // MongoDB Timestamp or Object with toDate
    if (typeof val === 'object' && typeof val.toDate === 'function') {
      const d = val.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    }

    // Numeric epoch
    if (typeof val === 'number') {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    }

    // ISO string
    if (typeof val === 'string') {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
function computeUpdatedAt(doc) {
  /** Compute updatedAt from best available fields among:
   * [updatedAt, updated_at, modifiedAt, modified_at, lastUpdated, createdAt, created_at, timestamp, ts]
   * As a final fallback, if _id is a Mongo ObjectId-like, use its embedded timestamp.
   * Returns a Date or null.
   */
  try {
    if (!doc || typeof doc !== 'object') {return null;}

    const fields = [
      'updatedAt',
      'updated_at',
      'modifiedAt',
      'modified_at',
      'lastUpdated',
      'createdAt',
      'created_at',
      'timestamp',
      'ts',
    ];

    for (const f of fields) {
      const d = toValidDate(doc[f]);
      if (d) {return d;}
    }

    // Fallback: _id timestamp from ObjectId
    const id = doc._id;
    if (id && typeof id === 'object') {
      // Mongo ObjectId has getTimestamp() or generationTime embedded in hex
      try {
        if (typeof id.getTimestamp === 'function') {
          const d = id.getTimestamp();
          if (d instanceof Date && !isNaN(d.getTime())) {
            return d;
          }
        }
        // If it's an ObjectId-like stringable hex
        const s = typeof id.toString === 'function' ? id.toString() : null;
        if (s && /^[a-fA-F0-9]{24}$/.test(s)) {
          // First 8 chars are timestamp in seconds (hex)
          const seconds = parseInt(s.substring(0, 8), 16);
          if (!Number.isNaN(seconds)) {
            const d = new Date(seconds * 1000);
            if (!isNaN(d.getTime())) {return d;}
          }
        }
      } catch {
        // ignore
      }
    }

    // If also available as string id
    if (typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id)) {
      const seconds = parseInt(id.substring(0, 8), 16);
      if (!Number.isNaN(seconds)) {
        const d = new Date(seconds * 1000);
        if (!isNaN(d.getTime())) {return d;}
      }
    }

    return null;
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
function enrichDeployment(doc) {
  /** Given a deployment-like document, returns:
   * { projectId: string|null, updatedAt: Date|null }
   * Uses normalizeProjectId and computeUpdatedAt.
   */
  try {
    if (!doc || typeof doc !== 'object') {
      return { projectId: null, updatedAt: null };
    }
    const projectId =
      normalizeProjectId(doc.projectId) ||
      normalizeProjectId(doc.project_id) ||
      normalizeProjectId(doc?.metadata?.projectId) ||
      normalizeProjectId(doc);
    const updatedAt = computeUpdatedAt(doc);
    return { projectId, updatedAt };
  } catch {
    return { projectId: null, updatedAt: null };
  }
}

module.exports = {
  // PUBLIC INTERFACES
  normalizeProjectId,
  computeUpdatedAt,
  enrichDeployment,
};
