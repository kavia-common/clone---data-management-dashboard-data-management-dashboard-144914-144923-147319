import React from "react";

/**
 * PUBLIC_INTERFACE
 * ErrorState
 * Accessible error display with optional retry action.
 *
 * Props:
 * - message: string
 * - onRetry?: () => void
 */
export default function ErrorState({ message = "Something went wrong.", onRetry }) {
  return (
    <div className="error" role="alert" aria-live="assertive" style={{ padding: 12, borderRadius: 8 }}>
      <div style={{ marginBottom: onRetry ? 8 : 0 }}>{message}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-secondary"
          aria-label="Retry loading"
          style={{
            background: "color-mix(in oklab, var(--color-accent) 14%, transparent)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
            borderRadius: 8,
            padding: "6px 10px",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
