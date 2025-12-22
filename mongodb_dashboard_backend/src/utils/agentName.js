"use strict";

/**
 * Utilities to derive agent_name from a cost document that may contain nested
 * users[].projects[].agents[] objects or other shapes. The logic is intentionally
 * defensive and tolerant to heterogeneous schemas.
 */

/**
 * Extract distinct non-empty strings from an iterable, trimmed.
 * @param {Iterable<any>} items
 * @returns {string[]}
 */
function distinctStrings(items) {
  const set = new Set();
  for (const x of items || []) {
    if (typeof x === "string") {
      const t = x.trim();
      if (t) set.add(t);
    }
  }
  return Array.from(set);
}

/**
 * Walks through possible nested shapes to collect agent names.
 * Supported shapes:
 *  - doc.agent_name
 *  - doc.agents[].agent_name
 *  - doc.users[].projects[].agents[].agent_name
 *  - doc.details?.agents[].agent_name
 *  - doc.details?.metadata?.agents[].agent_name
 *
 * Returns the first non-empty name when many exist, otherwise joins distinct with ", ".
 *
 * PUBLIC_INTERFACE
 * @param {object} doc Source document
 * @returns {string|null} Representative agent_name or null
 */
function deriveAgentName(doc) {
  if (!doc || typeof doc !== "object") return null;

  // Direct field already present
  if (typeof doc.agent_name === "string" && doc.agent_name.trim()) {
    return doc.agent_name.trim();
  }

  const collected = [];

  // Top-level agents array: [{ agent_name }]
  if (Array.isArray(doc.agents)) {
    for (const a of doc.agents) {
      if (a && typeof a.agent_name === "string" && a.agent_name.trim()) {
        collected.push(a.agent_name.trim());
      }
      // also support generic "name"
      if (a && typeof a.name === "string" && a.name.trim()) {
        collected.push(a.name.trim());
      }
    }
  }

  // Nested users[].projects[].agents[]
  if (Array.isArray(doc.users)) {
    for (const u of doc.users) {
      if (!u || typeof u !== "object") continue;
      const projects = Array.isArray(u.projects) ? u.projects : [];
      for (const p of projects) {
        if (!p || typeof p !== "object") continue;
        const agents = Array.isArray(p.agents) ? p.agents : [];
        for (const a of agents) {
          if (a && typeof a.agent_name === "string" && a.agent_name.trim()) {
            collected.push(a.agent_name.trim());
          }
          if (a && typeof a.name === "string" && a.name.trim()) {
            collected.push(a.name.trim());
          }
        }
      }
    }
  }

  // doc.details.agents
  const details = doc.details && typeof doc.details === "object" ? doc.details : null;
  if (details && Array.isArray(details.agents)) {
    for (const a of details.agents) {
      if (a && typeof a.agent_name === "string" && a.agent_name.trim()) {
        collected.push(a.agent_name.trim());
      }
      if (a && typeof a.name === "string" && a.name.trim()) {
        collected.push(a.name.trim());
      }
    }
  }

  // doc.details.metadata.agents
  const metadata = details && typeof details.metadata === "object" ? details.metadata : null;
  if (metadata && Array.isArray(metadata.agents)) {
    for (const a of metadata.agents) {
      if (a && typeof a.agent_name === "string" && a.agent_name.trim()) {
        collected.push(a.agent_name.trim());
      }
      if (a && typeof a.name === "string" && a.name.trim()) {
        collected.push(a.name.trim());
      }
    }
  }

  const names = distinctStrings(collected);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  // When multiple exist, return a joined distinct string. Frontend expects a string.
  return names.join(", ");
}

module.exports = {
  deriveAgentName,
};
