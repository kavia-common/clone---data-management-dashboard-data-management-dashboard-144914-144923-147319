import React from "react";

/**
 * PUBLIC_INTERFACE
 * Skeleton
 * Lightweight skeleton placeholder with dark-mode shimmer.
 *
 * Props:
 * - width?: number|string
 * - height?: number|string
 * - lines?: number (for text skeleton)
 * - circle?: boolean (renders a circle using height as diameter)
 * - className?: string
 * - style?: React.CSSProperties
 */
export default function Skeleton({
  width = "100%",
  height = 12,
  lines = 0,
  circle = false,
  className = "",
  style = {},
  "aria-label": ariaLabel = "Loading",
}) {
  const baseStyle = {
    width,
    height,
    ...(circle ? { borderRadius: "9999px" } : {}),
    ...style,
  };

  if (lines && lines > 1) {
    const lineArr = Array.from({ length: lines });
    return (
      <div role="status" aria-live="polite" aria-label={ariaLabel}>
        {lineArr.map((_, i) => (
          <div
            key={i}
            className="skeleton"
            style={{
              ...baseStyle,
              width: "100%",
              height,
              marginBottom: i === lines - 1 ? 0 : 8,
            }}
          />
        ))}
      </div>
    );
  }

  return <div className={`skeleton ${className}`.trim()} style={baseStyle} role="status" aria-label={ariaLabel} />;
}
