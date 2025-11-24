import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import "./TreeView.css";
import { formatLabel } from "../utils/formatLabel";
import { usdToCredits, formatCredits, parseUsdToNumber } from "../utils/currency";

/**
 * PUBLIC_INTERFACE
 * TreeView
 * A reusable, accessible, expandable tree viewer for rendering nested JSON (objects/arrays).
 *
 * Features:
 * - Recursive nodes for objects, arrays, and primitives.
 * - Root expanded and children collapsed by default (configurable via defaultExpandedDepth).
 * - Search: case-insensitive match against keys and primitive values; auto-expands to reveal matches.
 *   Matching substrings are highlighted.
 * - Expand all / Collapse all helpers exposed via ref.
 * - Long string values truncate inline with title tooltip for the full content.
 *
 * Props:
 * - data: any (required) - The JSON object/array/value to render.
 * - defaultExpandedDepth: number (default 1) - Depth below which nodes are expanded by default (root=0).
 * - searchTerm: string (optional) - Case-insensitive term to highlight and auto-expand to matches.
 * - className: string (optional)
 */
const TreeView = forwardRef(function TreeView(
  { data, defaultExpandedDepth = 1, searchTerm = "", className = "" },
  ref
) {
  // Expanded nodes stored by path ("root", "root.key", "root.key.0", etc.)
  const [expanded, setExpanded] = useState(() => new Set());
  const allExpandablePathsRef = useRef(new Set()); // populated after initial walk

  // Normalize and memoize search term and regex
  const normalizedTerm = (searchTerm || "").trim();
  const searchRegex = useMemo(() => {
    try {
      return normalizedTerm ? new RegExp(escapeRegExp(normalizedTerm), "i") : null;
    } catch {
      return null;
    }
  }, [normalizedTerm]);

  // Traverse data to collect:
  // - all expandable paths (objects/arrays)
  // - paths that match search (keys or primitive values)
  // - ancestor paths for matches (for auto-expand)
  const { allPaths, autoExpandPaths } = useMemo(() => {
    const expandablePaths = new Set();
    const matches = new Set();
    const autoExpand = new Set();
    const term = normalizedTerm;

    const visit = (node, path) => {
      const t = typeof node;
      const isObj = node !== null && t === "object";
      const isArr = Array.isArray(node);

      if (isObj) {
        expandablePaths.add(path);
        if (isArr) {
          // Iterate array items
          for (let i = 0; i < node.length; i++) {
            const item = node[i];
            // For search matching: for arrays, "key" is the index
            if (term && searchRegex) {
              const keyStr = String(i);
              if (searchRegex.test(keyStr)) {
                matches.add(`${path}.${i}`);
                // Add ancestors
                addAncestors(`${path}.${i}`, autoExpand);
              }
            }
            // Primitive value match
            if (term && searchRegex && (item == null || typeof item !== "object")) {
              const valStr = toDisplayString(item);
              if (searchRegex.test(valStr)) {
                matches.add(`${path}.${i}`);
                addAncestors(`${path}.${i}`, autoExpand);
              }
            }
            visit(item, `${path}.${i}`);
          }
        } else {
          // Object entries
          Object.keys(node || {}).forEach((k) => {
            const v = node[k];
            const childPath = `${path}.${k}`;

            if (term && searchRegex) {
              // Match key name
              if (searchRegex.test(k)) {
                matches.add(childPath);
                addAncestors(childPath, autoExpand);
              }
              // Match primitive value
              if (v == null || typeof v !== "object") {
                const vs = toDisplayString(v);
                if (searchRegex.test(vs)) {
                  matches.add(childPath);
                  addAncestors(childPath, autoExpand);
                }
              }
            }
            visit(v, childPath);
          });
        }
      } else {
        // primitive: nothing to add to expandable paths
      }
    };

    visit(data, "root");
    return { allPaths: expandablePaths, matchPaths: matches, autoExpandPaths: autoExpand };
  }, [data, normalizedTerm, searchRegex]);

  // Keep ref of all expandable paths to support expandAll quickly
  useEffect(() => {
    allExpandablePathsRef.current = allPaths;
  }, [allPaths]);

  // Expose imperative helpers to the parent (Costs.jsx)
  useImperativeHandle(
    ref,
    () => ({
      /**
       * PUBLIC_INTERFACE
       * Expand all nodes immediately (synchronous). Suitable for small datasets.
       */
      expandAll: () => {
        setExpanded(new Set(allExpandablePathsRef.current));
      },
      /**
       * PUBLIC_INTERFACE
       * Collapse all nodes immediately.
       */
      collapseAll: () => {
        setExpanded(new Set()); // defaultExpandedDepth still controls root/initial expansion
      },
      /**
       * PUBLIC_INTERFACE
       * Expand to reveal matched paths from the current search term.
       */
      expandToMatches: () => {
        setExpanded((prev) => {
          const next = new Set(prev);
          autoExpandPaths.forEach((p) => next.add(p));
          return next;
        });
      },
      /**
       * PUBLIC_INTERFACE
       * getAllExpandablePaths
       * Returns an array of path strings for all expandable nodes (objects/arrays).
       */
      getAllExpandablePaths: () => {
        return Array.from(allExpandablePathsRef.current || []);
      },
      /**
       * PUBLIC_INTERFACE
       * applyExpandBatch
       * Adds the given array of paths to the expanded set as a single batched update.
       */
      applyExpandBatch: (pathsBatch) => {
        if (!Array.isArray(pathsBatch) || pathsBatch.length === 0) return;
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const p of pathsBatch) next.add(p);
          return next;
        });
      },
      /**
       * PUBLIC_INTERFACE
       * setExpandedPaths
       * Replace or merge the expanded set with the provided collection of paths.
       * @param {Iterable<string>} paths
       * @param {boolean} replace - when true, replaces the entire set; otherwise merges.
       */
      setExpandedPaths: (paths, replace = false) => {
        if (!paths) return;
        const incoming = Array.isArray(paths) ? paths : Array.from(paths);
        if (replace) {
          setExpanded(new Set(incoming));
        } else {
          setExpanded((prev) => {
            const next = new Set(prev);
            for (const p of incoming) next.add(p);
            return next;
          });
        }
      },
    }),
    [autoExpandPaths]
  );

  const toggle = useCallback((path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Helper: is node expanded? Root/children expanded based on depth, manual toggles, or autoExpand (search)
  const isExpanded = useCallback(
    (path, depth) => {
      if (depth < defaultExpandedDepth) return true;
      if (expanded.has(path)) return true;
      if (autoExpandPaths.has(path)) return true;
      return false;
    },
    [defaultExpandedDepth, expanded, autoExpandPaths]
  );

  // Render functions
  const renderNode = useCallback(
    (value, path, keyLabel, depth) => {
      const t = typeof value;
      const isObj = value !== null && t === "object";
      const isArr = Array.isArray(value);
      const expandable = isObj;
      const open = expandable ? isExpanded(path, depth) : false;
      const padLeft = depth * 14;

      const typeBadge = isArr
        ? `Array(${value.length})`
        : isObj
        ? "Object"
        : null;

      // Display key with highlight
      // Apply label formatter only for display; underlying data is not mutated.
      const displayKey =
        typeof keyLabel === "string" ? formatLabel(keyLabel) : keyLabel;

      const keyContent =
        keyLabel != null ? (
          <span className="tv-key" title={String(displayKey)}>
            {highlight(String(displayKey), searchRegex)}
          </span>
        ) : null;

      // Display primitive value (inline, truncation and tooltip)
      const valContent =
        !isObj ? (() => {
          // Detect user_cost keys (robust: casing/spacing/underscore-insensitive)
          const normKey =
            typeof keyLabel === "string"
              ? keyLabel.toLowerCase().replace(/\s+/g, "_")
              : "";
          const looksUserCost = /(^|[_\s])user[_\s]?cost($|[_\s])/.test(normKey) || normKey === "usercost";
          if (looksUserCost) {
            const num = parseUsdToNumber(value);
            if (num != null) {
              const credits = usdToCredits(num);
              const creditsText = formatCredits(credits);
              const baseText = truncateIfNeeded(toDisplayString(value));
              return (
                <span
                  className={`tv-value ${shouldTruncate(value) ? "tv-ellipsis" : ""}`}
                  title={`${toDisplayString(value)} • Credits Used: ${creditsText}`}
                >
                  {highlight(baseText, searchRegex)}
                  <span className="tv-credits-inline" style={{ color: "#6b7280" }}> • Credits Used: {creditsText}</span>
                </span>
              );
            }
          }
          return (
            <span className={`tv-value ${shouldTruncate(value) ? "tv-ellipsis" : ""}`} title={toDisplayString(value)}>
              {highlight(truncateIfNeeded(toDisplayString(value)), searchRegex)}
            </span>
          );
        })() : null;

      return (
        <div key={path} className="tv-row" style={{ paddingLeft: padLeft }}>
          <div className="tv-row-main">
            {expandable ? (
              <button
                className="tv-toggle"
                aria-label={open ? "Collapse" : "Expand"}
                aria-expanded={open}
                onClick={() => toggle(path)}
                title={open ? "Collapse" : "Expand"}
              >
                <span className="tv-chevron" aria-hidden="true">
                  {open ? "\u25be" : "\u25b8"}
                </span>
              </button>
            ) : (
              <span className="tv-spacer" />
            )}
            {keyContent}
            {typeBadge ? (
              <span className="tv-badge" aria-label={typeBadge} title={typeBadge}>
                {typeBadge}
              </span>
            ) : null}
            {!isObj ? <span className="tv-colon">: </span> : null}
            {valContent}
            {/* Note: per-node copy actions removed per requirements */}
          </div>

          {expandable && open ? (
            <div className="tv-children">
              {isArr
                ? value.map((item, idx) => renderNode(item, `${path}.${idx}`, idx, depth + 1))
                : Object.keys(value || {}).map((k) =>
                    renderNode(value[k], `${path}.${k}`, k, depth + 1)
                  )}
            </div>
          ) : null}
        </div>
      );
    },
    [isExpanded, toggle, searchRegex]
  );

  return (
    <div className={`treeview ${className || ""}`}>
      {/* Render a synthetic "root" if data is object/array; for primitive, show a single row */}
      {data !== null && typeof data === "object" ? (
        <>
          {/* Root is expanded by default; show a label 'root' only when data isn't an array/object name */}
          <div className="tv-root">
            {renderNode(data, "root", "root", 0)}
          </div>
        </>
      ) : (
        <div className="tv-root">
          {renderNode(data, "root", "value", 0)}
        </div>
      )}
    </div>
  );
});

export default TreeView;

// Helpers

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toDisplayString(v) {
  // Render JSON-like primitive representation
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function shouldTruncate(v) {
  if (v == null) return false;
  const s = typeof v === "string" ? v : String(v);
  return s.length > 120;
}
function truncateIfNeeded(s, max = 120) {
  if (typeof s !== "string") return s;
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "\u2026";
}

function highlight(text, regex) {
  if (!regex || !text) return text;
  const parts = [];
  let lastIndex = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }
    parts.push(<span key={`${start}-${end}`} className="tv-highlight">{text.slice(start, end)}</span>);
    lastIndex = end;
    if (!regex.global) break; // safety, though we didn't use 'g'
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length ? parts : text;
}

function addAncestors(path, set) {
  const parts = path.split(".");
  for (let i = 1; i < parts.length; i++) {
    const p = parts.slice(0, i).join(".");
    set.add(p);
  }
}
