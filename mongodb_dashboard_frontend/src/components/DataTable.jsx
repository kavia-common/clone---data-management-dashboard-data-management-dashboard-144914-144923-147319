import React, { useMemo, useState } from "react";

// PUBLIC_INTERFACE
export default function DataTable({
  columns,
  data,
  loading,
  onEdit,
  onDelete,
  pageSize = 10,
  initialPage = 1,
  onPageChange,
}) {
  /** A simple data grid component with client-side sorting and action column, with pagination (default 10 per page). */
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(Math.max(1, initialPage || 1));

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

  // Pagination calculations
  const total = sorted?.length || 0;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * Math.max(1, pageSize);
  const end = start + Math.max(1, pageSize);
  const pageRows = sorted.slice(start, end);

  function setPageAndNotify(p) {
    const next = Math.min(Math.max(1, p), totalPages);
    setPage(next);
    if (typeof onPageChange === "function") onPageChange(next);
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    // Reset to first page when sort changes for UX predictability
    setPageAndNotify(1);
  }

  function PaginationControls() {
    if (totalPages <= 1) return null;
    const canPrev = currentPage > 1;
    const canNext = currentPage < totalPages;

    // Build a small list of page buttons (1 .. totalPages), compact when many pages
    const pages = [];
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage + 1 < maxButtons) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }
    for (let p = startPage; p <= endPage; p += 1) pages.push(p);

    return (
      <div
        className="table-pagination"
        role="navigation"
        aria-label="Table pagination"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div className="muted" style={{ fontSize: 12 }}>
          Showing {total ? start + 1 : 0}–{Math.min(end, total)} of {total}
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
        </div>
      </div>
    );
  }

  const actionColIncluded = (onEdit || onDelete) ? 1 : 0;

  return (
    <div className="table-wrapper" role="region" aria-label="Data table">
      {/* Header area: table column headers remain visible */}
      <div className="table-header">
        <table className="table" aria-hidden="true">
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
                >
                  {c.label}
                  {sortKey === c.key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
              {actionColIncluded ? <th className="th col-priority-4" scope="col">Actions</th> : null}
            </tr>
          </thead>
        </table>
      </div>

      {/* Scrollable content area: only rows scroll vertically */}
      <div className="table-scroll" role="grid" aria-rowcount={total}>
        <table className="table">
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
            {!loading && (pageRows || []).map((row) => (
              <tr className="tr" key={row._id || row.id || JSON.stringify(row)}>
                {columns.map((c) => {
                  const value = getValue(row, c.key);
                  const content = c.render ? c.render(value, row) : (value ?? "");
                  const isNumber = typeof value === "number";
                  const priorityClass = c.priority ? `col-priority-${c.priority}` : "";
                  return (
                    <td key={c.key} className={`td ${isNumber ? "num" : ""} ${priorityClass}`.trim()}>
                      {content === null || content === undefined || content === "" ? "—" : content}
                    </td>
                  );
                })}
                {actionColIncluded ? (
                  <td className="td actions col-priority-4">
                    {onEdit && <button className="btn btn-ghost" onClick={() => onEdit(row)}>Edit</button>}
                    {onDelete && <button className="btn btn-danger" onClick={() => onDelete(row)}>Delete</button>}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination stays visible; no layout shift on page change */}
      <PaginationControls />
    </div>
  );
}
