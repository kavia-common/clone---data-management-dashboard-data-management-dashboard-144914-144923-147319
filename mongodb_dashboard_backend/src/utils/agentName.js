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
 * @param {Array<[string,string?]>} getFieldPaths optional array of nested get-field paths
 */
function collectFromAgentsArray(
  arr,
  keys = ["agent_name", "name"],
  getFieldPaths = []
) {
  const out = [];
  const list = Array.isArray(arr)
    ? arr
    : arr && typeof arr === "object"
    ? [arr]
    : [];

  for (const a of list) {
    if (!a || typeof a !== "object") continue;

    for (const k of keys) {
      const v = a[k];
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    }

    // Support nested metadata fields (e.g., metadata["Agent Name"])
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
 *
 * Priority order:
 * 1) doc.agent_name or doc.agent/agentName/tool
 * 2) doc.agents[].{agent_name|name} and agents[].metadata["Agent Name"]
 * 3) doc.users -> projects -> agents (supports array OR object)
 * 4) doc.projects[].agents[] (top-level)
 * 5) doc.details.agents[] and doc.details.metadata.agents[]
 * 6) doc.metadata["Agent Name"] or doc["Agent Name"]
 * 7) FINAL fallback: infer from doc.type (aggregation-safe)
 *
 * Selection:
 * - When multiple names exist, returns a deterministic alphabetical value
 *
 * @param {object} doc
 * @returns {string|null}
 */
function deriveAgentName(doc) {
  if (!doc || typeof doc !== "object") return null;

  // 1️⃣ Direct fields
  const direct =
    (typeof doc.agent_name === "string" && doc.agent_name.trim()) ||
    (typeof doc.agent === "string" && doc.agent.trim()) ||
    (typeof doc.agentName === "string" && doc.agentName.trim()) ||
    (typeof doc.tool === "string" && doc.tool.trim());

  if (direct) return String(direct).trim();

  const collected = [];

  // 2️⃣ Top-level agents[]
  collected.push(
    ...collectFromAgentsArray(
      doc.agents,
      ["agent_name", "name"],
      [["metadata", "Agent Name"]]
    )
  );

  // 3️⃣ users -> projects -> agents
  const usersList = Array.isArray(doc.users)
    ? doc.users
    : doc.users && typeof doc.users === "object"
    ? [doc.users]
    : [];

  for (const u of usersList) {
    const projects = Array.isArray(u?.projects)
      ? u.projects
      : u?.projects && typeof u.projects === "object"
      ? [u.projects]
      : [];

    for (const p of projects) {
      collected.push(
        ...collectFromAgentsArray(
          p?.agents,
          ["agent_name", "name"],
          [["metadata", "Agent Name"]]
        )
      );
    }
  }

  // 4️⃣ Top-level projects[].agents[]
  const topProjects = Array.isArray(doc.projects)
    ? doc.projects
    : doc.projects && typeof doc.projects === "object"
    ? [doc.projects]
    : [];

  for (const p of topProjects) {
    collected.push(
      ...collectFromAgentsArray(
        p?.agents,
        ["agent_name", "name"],
        [["metadata", "Agent Name"]]
      )
    );
  }

  // 5️⃣ details.agents[] and details.metadata.agents[]
  const details = doc.details && typeof doc.details === "object" ? doc.details : null;

  if (details) {
    collected.push(
      ...collectFromAgentsArray(
        details.agents,
        ["agent_name", "name"],
        [["metadata", "Agent Name"]]
      )
    );

    const meta =
      details.metadata && typeof details.metadata === "object"
        ? details.metadata
        : null;

    if (meta) {
      collected.push(
        ...collectFromAgentsArray(
          meta.agents,
          ["agent_name", "name"],
          [["metadata", "Agent Name"]]
        )
      );
    }
  }

  // 6️⃣ metadata["Agent Name"] or top-level ["Agent Name"]
  if (typeof doc?.metadata?.["Agent Name"] === "string") {
    collected.push(doc.metadata["Agent Name"].trim());
  }

  if (typeof doc["Agent Name"] === "string") {
    collected.push(doc["Agent Name"].trim());
  }

  const names = distinctStrings(collected);
  if (names.length === 1) return names[0];
  if (names.length > 1) {
    return names.sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    )[0];
  }

  // 7️⃣ FINAL fallback → infer from type (aggregation-safe)
  if (typeof doc.type === "string" && doc.type.trim()) {
    const type = doc.type.toLowerCase();

    const TYPE_AGENT_MAP = {
      llm_interaction: "LLM",
      chat: "CHAT",
      completion: "COMPLETION",
      embedding: "EMBEDDING",
      moderation: "MODERATION",
    };

    return TYPE_AGENT_MAP[type] || type.toUpperCase();
  }

  return null;
}

module.exports = {
  deriveAgentName,
};
