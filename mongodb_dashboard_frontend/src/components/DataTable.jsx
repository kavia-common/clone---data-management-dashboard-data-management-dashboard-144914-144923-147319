import React, { useMemo, useState } from "react";

// PUBLIC_INTERFACE
export default function DataTable({ columns, data, loading, onEdit, onDelete }) {
  /** A simple data grid component with client-side sorting and action column. */
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState("asc");

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
        ? String(av || "").localeCompare(String(bv || ""))
        : String(bv || "").localeCompare(String(av || ""));
    });
    return copy;
  }, [data, sortDir, sortKey]);

  function getValue(row, path) {
    return path.split(".").reduce((acc, key) => (acc ? acc[key] : undefined), row);
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className="table-wrapper">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} onClick={() => toggleSort(c.key)} role="button" className="th">
                {c.label}
                {sortKey === c.key && (sortDir === "asc" ? " ▲" : " ▼")}
              </th>
            ))}
            {(onEdit || onDelete) && <th className="th">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={columns.length + 1}><div className="table-empty">Loading...</div></td></tr>
          )}
          {!loading && (!sorted || sorted.length === 0) && (
            <tr><td colSpan={columns.length + 1}><div className="table-empty">No data</div></td></tr>
          )}
          {!loading && sorted && sorted.map((row) => (
            <tr key={row._id || row.id || JSON.stringify(row)}>
              {columns.map((c) => (
                <td key={c.key} className="td">
                  {c.render ? c.render(getValue(row, c.key), row) : String(getValue(row, c.key) ?? "")}
                </td>
              ))}
              {(onEdit || onDelete) && (
                <td className="td actions">
                  {onEdit && <button className="btn btn-ghost" onClick={() => onEdit(row)}>Edit</button>}
                  {onDelete && <button className="btn btn-danger" onClick={() => onDelete(row)}>Delete</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
