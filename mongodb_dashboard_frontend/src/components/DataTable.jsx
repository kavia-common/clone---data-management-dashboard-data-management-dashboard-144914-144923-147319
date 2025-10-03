import React, { useMemo, useRef, useState } from "react";

/**
 * Measure text width using an off-screen canvas for robust auto-width calculation.
 * Falls back gracefully if canvas is unavailable.
 */
function measureTextWidth(text, font = "14px Helvetica, Arial, sans-serif") {
  try {
    const canvas = measureTextWidth._canvas || (measureTextWidth._canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = font;
    const metrics = context.measureText(String(text ?? ""));
    return Math.ceil(metrics.width);
  } catch {
    return String(text ?? "").length * 8;
  }
}

// PUBLIC_INTERFACE
export default function DataTable({
  columns,
  data,
  loading,
  onEdit,
  onDelete,
  onRowClick,
  pageSize = 10,
  initialPage = 1,
  onPageChange,
  autoWidth = true,
  minColWidth = 56,
  maxColWidth = 420,
  // Optional override for scroll height
  maxBodyHeight, // if provided, will override CSS default via inline style
  // PUBLIC_INTERFACE
  // forceHorizontalScroll: when true, ensures a min table width larger than wrapper to always show an X scrollbar.
  forceHorizontalScroll = false,
  // PUBLIC_INTERFACE
  serverTotal, // optional: pass total item count from server to compute total pages in server mode
  // PUBLIC_INTERFACE
  fetchPage, // optional: async function (page, pageSize, sortKey, sortDir) => void to load data from server on page change
  // PUBLIC_INTERFACE
  paginationTitle = "Pages", // optional title beside pagination controls to improve visibility
}) {
  /**
   * DataTable with sticky header and always-visible pagination.
   * Body is contained in a scrollable region with vertical and horizontal scroll as needed.
   * Improvements in this version:
   * - Ensures horizontal scroll is always available when columns exceed wrapper width or when forceHorizontalScroll is true.
   * - Pagination area is outside of the scrollable body and remains visible regardless of scroll position.
   * - Slight visual affordances (shadow) appear on the header when the body content is scrolled.
   */
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(Math.max(1, initialPage || 1));

  const bodyRef = useRef(null);
  const headerRef = useRef(null);

  function getValue(row, path) {
    if (!row || !path) return undefined;
    try {
      return path.split(".").reduce((acc, key) => {
        if (acc === null || acc === undefined) return undefined;
        return acc[key];
      }, row);
    } catch {
      return undefined;
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return data || [];
    const copy = [...(data || [])];
    copy.sort((a, b) => {
      const av = getValue(a, sortKey);
      const bv = getValue(b, sortKey);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av ?? "").localeCompare(String(bv ?? ""))
        : String(bv ?? "").localeCompare(String(av ?? ""));
    });
    return copy;
  }, [data, sortDir, sortKey]);

  // Determine total and pagination mode
  const clientTotal = sorted?.length || 0;
  const isServerMode = typeof fetchPage === "function" && typeof serverTotal === "number";
  const total = isServerMode ? Math.max(0, serverTotal) : clientTotal;

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  // In client mode slice locally; in server mode assume data already corresponds to current page
  const start = (currentPage - 1) * Math.max(1, pageSize);
  const end = start + Math.max(1, pageSize);
  const pageRows = isServerMode ? (sorted || []) : sorted.slice(start, end);

  async function setPageAndNotify(p) {
    const next = Math.min(Math.max(1, p), totalPages);
    setPage(next);
    if (typeof onPageChange === "function") onPageChange(next);

    // If in server mode, ask parent to load data for the new page
    if (typeof fetchPage === "function") {
      try {
        await fetchPage(next, Math.max(1, pageSize), sortKey, sortDir);
      } catch {
        // swallow; parent can own error UI
      }
    }
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
      // Keep pagination visible; do not auto-reset horizontal scroll as users may be inspecting right-most columns.
      // bodyRef.current.scrollLeft = 0;
    }
  }

  async function toggleSort(key) {
    let nextDir = "asc";
    if (sortKey === key) {
      nextDir = sortDir === "asc" ? "desc" : "asc";
      setSortDir(nextDir);
    } else {
      setSortKey(key);
      nextDir = "asc";
      setSortDir("asc");
    }
    // Reset to first page
    if (typeof fetchPage === "function") {
      try {
        await fetchPage(1, Math.max(1, pageSize), key, nextDir);
      } catch {
        // ignore errors; parent handles UI
      }
    }
    setPageAndNotify(1);
  }

  // Add a small shadow class to header when body is scrolled vertically to provide context separation.
  function onBodyScroll(e) {
    const target = e.currentTarget;
    const scrolled = target.scrollTop > 0;
    if (headerRef.current) {
      if (scrolled) headerRef.current.classList.add("table-header--scrolled");
      else headerRef.current.classList.remove("table-header--scrolled");
    }
  }

  function PaginationControls() {
    if (totalPages <= 1) return null;
    const canPrev = currentPage > 1;
    const canNext = currentPage < totalPages;

    const pages = [];
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage + 1 < maxButtons) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }
    for (let p = startPage; p <= endPage; p += 1) pages.push(p);

    return (
      <div className="table-pagination" role="navigation" aria-label="Table pagination">
        <div className="muted" style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
          {paginationTitle}
          <span style={{ fontWeight: 400, marginLeft: 8 }}>
            Showing {total ? start + 1 : 0}–{Math.min(end, total)} of {total}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            className="btn btn-secondary"
            onClick={() => setPageAndNotify(1)}
            disabled={!canPrev}
            aria-label="First page"
            title="First page"
          >
            «
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setPageAndNotify(currentPage - 1)}
            disabled={!canPrev}
            aria-label="Previous page"
            title="Previous page"
          >
            ‹
          </button>
          {startPage > 1 && (
            <button
              className="btn btn-ghost"
              onClick={() => setPageAndNotify(startPage - 1)}
              title="More previous pages"
              aria-label="More previous pages"
            >
              …
            </button>
          )}
          {pages.map((p) => (
            <button
              key={p}
              className={`btn ${p === currentPage ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setPageAndNotify(p)}
              aria-current={p === currentPage ? "page" : undefined}
              aria-label={`Page ${p}`}
            >
              {p}
            </button>
          ))}
          {endPage < totalPages && (
            <button
              className="btn btn-ghost"
              onClick={() => setPageAndNotify(endPage + 1)}
              title="More next pages"
              aria-label="More next pages"
            >
              …
            </button>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => setPageAndNotify(currentPage + 1)}
            disabled={!canNext}
            aria-label="Next page"
            title="Next page"
          >
            ›
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => setPageAndNotify(totalPages)}
            disabled={!canNext}
            aria-label="Last page"
            title="Last page"
          >
            »
          </button>
          <div style={{ marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <label htmlFor="page-jump" className="muted" style={{ fontSize: 12 }}>Go to</label>
            <input
              id="page-jump"
              type="number"
              min={1}
              max={totalPages}
              defaultValue={currentPage}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = parseInt(e.currentTarget.value, 10);
                  if (!Number.isNaN(val)) setPageAndNotify(val);
                }
              }}
              style={{
                width: 64,
                height: 32,
                border: "1px solid var(--input-border)",
                borderRadius: 8,
                padding: "0 8px",
                background: "var(--bg-surface)",
              }}
              aria-label="Go to page"
            />
            <span className="muted" style={{ fontSize: 12 }}>/ {totalPages}</span>
          </div>
        </div>
      </div>
    );
  }

  const actionColIncluded = (onEdit || onDelete) ? 1 : 0;
  const fillerCount = Math.max(0, Math.max(1, pageSize) - (loading ? 0 : pageRows.length));

  const columnWidths = useMemo(() => {
    if (!autoWidth) return {};
    const fontHeader = "600 12px Helvetica, Arial, sans-serif";
    const fontCell = "14px Helvetica, Arial, sans-serif";

    const widths = {};
    (columns || []).forEach((c) => {
      const headerW = measureTextWidth(c.label ?? c.key, fontHeader);
      let maxW = headerW;
      (pageRows || []).forEach((row) => {
        const v = c.render ? c.render(getValue(row, c.key), row) : getValue(row, c.key);
        let text = "";
        if (typeof v === "number") text = v.toLocaleString();
        else if (typeof v === "string") text = v;
        else if (v === null || v === undefined || v === "") text = "—";
        else text = "";
        const w = text ? measureTextWidth(text, fontCell) : headerW;
        if (w > maxW) maxW = w;
      });
      maxW += 24 + 16;
      widths[c.key] = Math.min(Math.max(maxW, minColWidth), maxColWidth);
    });

    if (actionColIncluded) {
      widths.__actions = 160;
    }
    return widths;
  }, [columns, pageRows, autoWidth, minColWidth, maxColWidth, actionColIncluded]);

  // If forced, set a minWidth on tables to ensure horizontal scrollbar appears even with a few columns.
  const forcedMinWidth = forceHorizontalScroll ? Math.max(960, (columns?.length || 1) * 160 + (actionColIncluded ? 160 : 0)) : undefined;

  return (
    <div className="table-wrapper" role="region" aria-label="Data table">
      {/* Header area */}
      <div className="table-header" ref={headerRef}>
        <table className="table" aria-hidden="true" style={forcedMinWidth ? { minWidth: forcedMinWidth } : undefined}>
          <colgroup>
            {(columns || []).map((c) => (
              <col key={c.key} style={autoWidth ? { width: columnWidths[c.key] } : undefined} />
            ))}
            {actionColIncluded ? <col style={{ width: columnWidths.__actions }} /> : null}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  role="button"
                  className={`th ${c.priority ? `col-priority-${c.priority}` : ""}`.trim()}
                  scope="col"
                  aria-sort={sortKey === c.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  title="Click to sort"
                  style={autoWidth ? { width: columnWidths[c.key], minWidth: columnWidths[c.key] } : undefined}
                >
                  {c.label}
                  {sortKey === c.key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
              {actionColIncluded ? (
                <th
                  className="th col-priority-4"
                  scope="col"
                  style={{ width: columnWidths.__actions, minWidth: columnWidths.__actions }}
                >
                  Actions
                </th>
              ) : null}
            </tr>
          </thead>
        </table>
      </div>

      {/* Scrollable body */}
      <div
        className="table-scroll"
        role="grid"
        aria-rowcount={total}
        ref={bodyRef}
        onScroll={onBodyScroll}
        style={maxBodyHeight ? { maxHeight: maxBodyHeight } : undefined}
      >
        <table className="table" style={forcedMinWidth ? { minWidth: forcedMinWidth } : undefined}>
          <colgroup>
            {(columns || []).map((c) => (
              <col key={c.key} style={autoWidth ? { width: columnWidths[c.key] } : undefined} />
            ))}
            {actionColIncluded ? <col style={{ width: columnWidths.__actions }} /> : null}
          </colgroup>
          <tbody>
            {loading && (
              <tr className="tr">
                <td colSpan={columns.length + actionColIncluded}>
                  <div className="table-empty">Loading...</div>
                </td>
              </tr>
            )}
            {!loading && (!sorted || sorted.length === 0) && (
              <tr className="tr">
                <td colSpan={columns.length + actionColIncluded}>
                  <div className="table-empty">No data</div>
                </td>
              </tr>
            )}
            {!loading &&
              (pageRows || []).map((row) => (
                <tr
                  className="tr"
                  key={row._id || row.id || JSON.stringify(row)}
                  onClick={() => { if (typeof onRowClick === "function") onRowClick(row); }}
                  onKeyDown={(e) => {
                    if (!onRowClick) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick(row);
                    }
                  }}
                  tabIndex={typeof onRowClick === "function" ? 0 : undefined}
                  style={typeof onRowClick === "function" ? { cursor: "pointer" } : undefined}
                >
                  {columns.map((c) => {
                    const value = getValue(row, c.key);
                    const content = c.render ? c.render(value, row) : value ?? "";
                    const isNumber = typeof value === "number";
                    const priorityClass = c.priority ? `col-priority-${c.priority}` : "";
                    return (
                      <td
                        key={c.key}
                        className={`td ${isNumber ? "num" : ""} ${priorityClass} ${c.key === "name" ? "td--emphasis-name" : ""}`.trim()}
                        style={autoWidth ? { width: columnWidths[c.key], minWidth: columnWidths[c.key] } : undefined}
                        title={typeof content === "string" ? content : undefined}
                      >
                        {content === null || content === undefined || content === "" ? "—" : content}
                      </td>
                    );
                  })}
                  {actionColIncluded ? (
                    <td
                      className="td actions col-priority-4"
                      style={{ width: columnWidths.__actions, minWidth: columnWidths.__actions }}
                    >
                      {onEdit && (
                        <button
                          className="btn btn-ghost"
                          onClick={(e) => { e.stopPropagation(); onEdit(row); }}
                          aria-label="Edit row"
                          title="Edit"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>
                      )}
                      {onDelete && (
                        <button
                          className="btn btn-danger"
                          onClick={(e) => { e.stopPropagation(); onDelete(row); }}
                          aria-label="Delete row"
                          title="Delete"
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            {!loading &&
              fillerCount > 0 &&
              Array.from({ length: fillerCount }).map((_, idx) => (
                <tr className="tr tr--filler" key={`filler-${idx}`} aria-hidden="true">
                  <td className="td" colSpan={columns.length + actionColIncluded}>
                    &nbsp;
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Always visible pagination controls */}
      <PaginationControls />
    </div>
  );
}
