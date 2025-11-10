import React from "react";
import PropTypes from "prop-types";

/**
 * PUBLIC_INTERFACE
 * TimeBucketFilter
 * A small segmented control for selecting time bucket granularity.
 *
 * Props:
 * - value: 'daily' | 'weekly' | 'monthly'
 * - onChange: (newValue: string) => void
 * - options?: array override of { value, label } (default: Daily/Weekly/Monthly)
 * - disabled?: boolean
 */
export default function TimeBucketFilter({ value, onChange, options, disabled = false }) {
  const opts =
    options && options.length
      ? options
      : [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ];

  const baseBtn = {
    padding: "6px 10px",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 600,
    transition: "background 150ms ease, color 150ms ease",
  };

  return (
    <div
      role="group"
      aria-label="Time bucket"
      style={{
        display: "inline-flex",
        border: "1px solid #d1d5db",
        borderRadius: 8,
        overflow: "hidden",
        background: "#ffffff",
      }}
    >
      {opts.map((opt, idx) => {
        const active =
          String(value).toLowerCase() === String(opt.value).toLowerCase();
        return (
          <button
            key={opt.value}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!disabled) onChange(opt.value);
            }}
            disabled={disabled}
            style={{
              ...baseBtn,
              background: active ? "#2563EB" : "white",
              color: active ? "white" : "#111827",
              opacity: disabled ? 0.6 : 1,
              borderRight:
                idx < opts.length - 1 ? "1px solid #e5e7eb" : "none",
            }}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

TimeBucketFilter.propTypes = {
  value: PropTypes.oneOf(["daily", "weekly", "monthly"]).isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })
  ),
  disabled: PropTypes.bool,
};
