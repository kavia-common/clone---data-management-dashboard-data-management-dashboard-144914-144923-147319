import React from "react";

/**
 * PUBLIC_INTERFACE
 * DateDetails
 * Renders a date-to-value map in a compact grid, using Ocean Professional styles.
 */
export default function DateDetails({ title, data }) {
  const isCost = String(title || "").toLowerCase().includes("cost");
  const entries = data && typeof data === "object" ? Object.entries(data) : [];

  if (!entries.length) {
    return (
      <p
        className="muted"
        style={{ fontSize: 12, fontStyle: "italic", margin: "6px 0" }}
        data-testid="datedetails-empty"
      >
        No {String(title || "").toLowerCase()} recorded.
      </p>
    );
  }

  return (
    <div
      className="date-details"
      style={{
        marginTop: 4,
        padding: 12,
        background: "var(--bg-surface, #ffffff)",
        borderRadius: 10,
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.03)",
        border: "1px solid var(--border-subtle, #E5E7EB)",
      }}
    >
      <h4
        style={{
          margin: 0,
          marginBottom: 8,
          fontSize: 12,
          fontWeight: 700,
          color: "var(--text-secondary, #475569)",
        }}
      >
        {title}
      </h4>
      <div
        className="date-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0,1fr))",
          columnGap: 12,
          rowGap: 6,
          fontSize: 12,
        }}
      >
        {entries.map(([date, value]) => {
          const display = isCost
            ? (() => {
                try {
                  return new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 6,
                  }).format(Number(value));
                } catch {
                  return `$${Number(value).toFixed(6)}`;
                }
              })()
            : (() => {
                try {
                  const num = Number(value);
                  return Number.isFinite(num) ? num.toLocaleString() : String(value);
                } catch {
                  return String(value);
                }
              })();

          return (
            <div
              key={date}
              className="date-row"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{date}:</span>
              <span
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "#1D4ED8",
                }}
              >
                {display}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
