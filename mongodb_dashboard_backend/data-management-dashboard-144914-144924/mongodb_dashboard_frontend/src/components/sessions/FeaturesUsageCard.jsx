import React from "react";

/**
 * PUBLIC_INTERFACE
 * FeaturesUsageCard
 * Renders a titled card showing a vertical list of features with counts.
 * Props:
 *  - title: string
 *  - items: Array<{ feature: string, count: number }>
 *  - loading: boolean
 *  - emptyHint?: string
 */
export default function FeaturesUsageCard({ title, items, loading, emptyHint }) {
  return (
    <div className="card features-usage" style={{
      background: "#fff",
      borderRadius: 12,
      boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
      border: "1px solid #e5e7eb",
      padding: 16,
    }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#111827" }}>{title}</div>
      </div>
      <div>
        {loading ? (
          <div aria-busy="true" aria-label="Loading feature usage">
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < 4 ? "1px dashed #e5e7eb" : "none" }}>
                <div style={{ width: "60%", height: 12, background: "linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 37%,#f3f4f6 63%)", backgroundSize: "400% 100%", animation: "pulse 1.2s ease-in-out infinite", borderRadius: 6 }} />
                <div style={{ width: 40, height: 12, background: "linear-gradient(90deg,#f3f4f6 25%,#e5e7eb 37%,#f3f4f6 63%)", backgroundSize: "400% 100%", animation: "pulse 1.2s ease-in-out infinite", borderRadius: 6 }} />
              </div>
            ))}
          </div>
        ) : Array.isArray(items) && items.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((it, idx) => (
              <li key={`${it.feature}-${idx}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: idx < items.length - 1 ? "1px dashed #e5e7eb" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-flex", width: 8, height: 8, borderRadius: 9999, background: idx < 3 ? "#2563EB" : "#9CA3AF" }} />
                  <span style={{ color: "#111827" }}>{it.feature}</span>
                </div>
                <span style={{ fontVariantNumeric: "tabular-nums", color: "#111827", fontWeight: 600 }}>{it.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div role="note" style={{ color: "#6b7280", padding: "8px 0" }}>
            {emptyHint || "No data available for current filters."}
          </div>
        )}
      </div>
    </div>
  );
}
