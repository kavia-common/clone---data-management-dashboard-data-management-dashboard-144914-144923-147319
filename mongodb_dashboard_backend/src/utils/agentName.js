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
 * Collect candidate names from a list of agent-like objects supporting various keys.
 * @param {Array<any>} arr
 * @param {string[]} keys
 * @param {Array<[string,string?]>} getFieldPaths optional array of nested get-field paths like [['metadata','Agent Name']]
 */
function collectFromAgentsArray(arr, keys = ["agent_name", "name"], getFieldPaths = []) {
  const out = [];
  const list = Array.isArray(arr) ? arr : [];
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    for (const k of keys) {
      const v = a[k];
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    }
    // Support fields with spaces via nested objects (e.g., { "Agent Name": "..." })
    for (const [objKey, fieldKey] of getFieldPaths) {
      try {
        const obj = a?.[objKey];
        const v = obj && typeof obj === "object" ? obj[fieldKey] : null;
        if (typeof v === "string" && v.trim()) out.push(v.trim());
      } catch {}
    }
  }
  return out;
}

/**
 * PUBLIC_INTERFACE
 * deriveAgentName
 * Derives a representative agent_name from heterogeneous llm_costs document shapes.
 * Priority order:
 * 1) doc.agent_name or doc.agent/agentName/tool
 * 2) doc.agents[].{agent_name|name} and agents[].metadata["Agent Name"]
 * 3) doc.users[].projects[].agents[] variants
 * 4) doc.projects[].agents[] variants (top-level projects array)
 * 5) doc.details.agents[] and doc.details.metadata.agents[]
 * 6) doc.metadata["Agent Name"] or doc["Agent Name"] (top-level)
 * Selection: When multiple distinct names exist, choose deterministically by locale-insensitive alphabetical order.
 * @param {object} doc
 * @returns {string|null}
 */
function deriveAgentName(doc) {
  if (!doc || typeof doc !== "object") return null;

  // Direct fields first
  const direct =
    (typeof doc.agent_name === "string" && doc.agent_name.trim()) ||
    (typeof doc.agent === "string" && doc.agent.trim()) ||
    (typeof doc.agentName === "string" && doc.agentName.trim()) ||
    (typeof doc.tool === "string" && doc.tool.trim());
  if (direct) return String(direct).trim();

  const collected = [];

  // Top-level agents: [{ agent_name|name, metadata: { "Agent Name": ... } }]
  collected.push(
    ...collectFromAgentsArray(doc.agents, ["agent_name", "name"], [["metadata", "Agent Name"]])
  );

  // Nested users[].projects[].agents[]
  if (Array.isArray(doc.users)) {
    for (const u of doc.users) {
      const projects = Array.isArray(u?.projects) ? u.projects : [];
      for (const p of projects) {
        collected.push(
          ...collectFromAgentsArray(p?.agents, ["agent_name", "name"], [["metadata", "Agent Name"]])
        );
      }
    }
  }

  // Top-level projects[].agents[]
  if (Array.isArray(doc.projects)) {
    for (const p of doc.projects) {
      collected.push(
        ...collectFromAgentsArray(p?.agents, ["agent_name", "name"], [["metadata", "Agent Name"]])
      );
    }
  }

  // details.agents[]
  const details = doc.details && typeof doc.details === "object" ? doc.details : null;
  if (details) {
    collected.push(
      ...collectFromAgentsArray(details.agents, ["agent_name", "name"], [["metadata", "Agent Name"]])
    );
    // details.metadata.agents[]
    const meta = details.metadata && typeof details.metadata === "object" ? details.metadata : null;
    if (meta) {
      collected.push(
        ...collectFromAgentsArray(meta.agents, ["agent_name", "name"], [["metadata", "Agent Name"]])
      );
    }
  }

  // metadata["Agent Name"] and top-level ["Agent Name"]
  const metaAgentName =
    doc.metadata && typeof doc.metadata === "object" ? doc.metadata["Agent Name"] : null;
  if (typeof metaAgentName === "string" && metaAgentName.trim()) {
    collected.push(metaAgentName.trim());
  }
  const topAgentName = doc["Agent Name"];
  if (typeof topAgentName === "string" && topAgentName.trim()) {
    collected.push(topAgentName.trim());
  }

  const names = distinctStrings(collected);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];

  // Deterministic selection: choose the first after case-insensitive sort
  const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return sorted[0];
}

module.exports = {
  deriveAgentName,
};
