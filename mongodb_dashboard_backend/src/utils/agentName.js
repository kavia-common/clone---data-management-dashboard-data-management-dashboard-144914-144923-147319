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
 * Parse a currency-like or numeric-like value to Number.
 * Strips non-digit/decimal characters (e.g., "$12.34", "USD 1,234.50").
 * Returns NaN when not parseable.
 * @param {any} v
 * @returns {number}
 */
function parseMoneyToNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.+-eE]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/**
 * Collect candidate agents from various shapes with an optional cost field to rank.
 * Each candidate is represented as { name: string, totalCost: number|NaN }.
 * @param {object} doc
 * @returns {{name: string, totalCost: number}[]}
 */
function collectAgentCandidates(doc) {
  const out = [];

  // Direct top-level fields (rare): { agent_name, total_cost }
  if (doc && typeof doc === "object") {
    if (typeof doc.agent_name === "string" && doc.agent_name.trim()) {
      out.push({ name: doc.agent_name.trim(), totalCost: parseMoneyToNumber(doc.total_cost) });
    }
  }

  // doc.agents[]: allow variants { agent_name, name, total_cost, totalCost, "Total Cost" }
  if (Array.isArray(doc?.agents)) {
    for (const a of doc.agents) {
      if (!a || typeof a !== "object") continue;
      const nm = typeof a.agent_name === "string" && a.agent_name.trim()
        ? a.agent_name.trim()
        : (typeof a.name === "string" && a.name.trim() ? a.name.trim() : null);
      if (!nm) continue;
      const tc = parseMoneyToNumber(
        a.total_cost ?? a.totalCost ?? a["Total Cost"] ?? a.cost_usd ?? a.cost
      );
      out.push({ name: nm, totalCost: tc });
    }
  }

  // users[].projects[].agents[]
  if (Array.isArray(doc?.users)) {
    for (const u of doc.users) {
      const projects = Array.isArray(u?.projects) ? u.projects : [];
      for (const p of projects) {
        const agents = Array.isArray(p?.agents) ? p.agents : [];
        for (const a of agents) {
          if (!a || typeof a !== "object") continue;
          const nm = typeof a.agent_name === "string" && a.agent_name.trim()
            ? a.agent_name.trim()
            : (typeof a.name === "string" && a.name.trim() ? a.name.trim() : null);
          if (!nm) continue;
          const tc = parseMoneyToNumber(
            a.total_cost ?? a.totalCost ?? a["Total Cost"] ?? a.cost_usd ?? a.cost
          );
          out.push({ name: nm, totalCost: tc });
        }
      }
    }
  }

  // details.agents and details.metadata.agents
  const details = doc && typeof doc === "object" ? doc.details : null;
  const meta = details && typeof details === "object" ? details.metadata : null;
  const nestedAgentsArrays = [];
  if (Array.isArray(details?.agents)) nestedAgentsArrays.push(details.agents);
  if (Array.isArray(meta?.agents)) nestedAgentsArrays.push(meta.agents);
  for (const arr of nestedAgentsArrays) {
    for (const a of arr) {
      if (!a || typeof a !== "object") continue;
      const nm = typeof a.agent_name === "string" && a.agent_name.trim()
        ? a.agent_name.trim()
        : (typeof a.name === "string" && a.name.trim() ? a.name.trim() : null);
      if (!nm) continue;
      const tc = parseMoneyToNumber(
        a.total_cost ?? a.totalCost ?? a["Total Cost"] ?? a.cost_usd ?? a.cost
      );
      out.push({ name: nm, totalCost: tc });
    }
  }

  return out;
}

/**
 * PUBLIC_INTERFACE
 * Derive a representative agent_name from a heterogeneous document.
 * Rule when multiple names exist:
 *   - Prefer the agent with the highest total_cost (numeric parse).
 *   - If totals are equal or NaN, fall back to alphabetical by name.
 * Handles variations in structure and empty arrays.
 * @param {object} doc
 * @returns {string|null}
 */
function deriveAgentName(doc) {
  if (!doc || typeof doc !== "object") return null;

  // If a clean top-level agent_name already exists, still validate it
  if (typeof doc.agent_name === "string" && doc.agent_name.trim()) {
    return doc.agent_name.trim();
  }

  const candidates = collectAgentCandidates(doc);
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  // Aggregate by name: compute best (max) totalCost per name
  const byName = new Map();
  for (const c of candidates) {
    const key = c.name;
    const current = byName.get(key);
    const tc = Number.isFinite(c.totalCost) ? c.totalCost : NaN;
    if (!current) {
      byName.set(key, { name: key, totalCost: tc });
    } else {
      const prev = Number.isFinite(current.totalCost) ? current.totalCost : NaN;
      if (Number.isFinite(tc)) {
        if (!Number.isFinite(prev) || tc > prev) {
          byName.set(key, { name: key, totalCost: tc });
        }
      } else {
        // keep previous (prefer finite over NaN)
      }
    }
  }

  const arr = Array.from(byName.values());
  if (arr.length === 1) return arr[0].name;

  // Sort by:
  // 1) totalCost desc (finite > NaN)
  // 2) name alphabetical asc
  arr.sort((a, b) => {
    const aFinite = Number.isFinite(a.totalCost);
    const bFinite = Number.isFinite(b.totalCost);
    if (aFinite && bFinite) {
      if (b.totalCost !== a.totalCost) return b.totalCost - a.totalCost;
    } else if (aFinite && !bFinite) {
      return -1; // a before b
    } else if (!aFinite && bFinite) {
      return 1; // b before a
    }
    return a.name.localeCompare(b.name);
  });

  return arr[0]?.name || null;
}

/**
 * PUBLIC_INTERFACE
 * Extract distinct agent names as a flat array (no ranking), useful for diagnostics.
 * @param {object} doc
 * @returns {string[]}
 */
function extractDistinctAgentNames(doc) {
  const cands = collectAgentCandidates(doc);
  return distinctStrings(cands.map((c) => c.name));
}

module.exports = {
  deriveAgentName,
  extractDistinctAgentNames,
};
