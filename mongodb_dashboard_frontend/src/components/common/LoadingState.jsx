import React from "react";

/**
 * PUBLIC_INTERFACE
 * LoadingState
 * Accessible loading state with optional message and size.
 *
 * Props:
 * - message?: string
 * - height?: number|string
 */
export default function LoadingState({ message = "Loading...", height = 120 }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ minHeight: height, display: "grid", placeItems: "center" }}
    >
      <div style={{ textAlign: "center", color: "var(--color-text-secondary)" }}>
        <div className="skeleton" style={{ width: 220, height: 14, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 180, height: 14 }} />
        <div style={{ marginTop: 12, fontSize: 12 }}>{message}</div>
      </div>
    </div>
  );
}
