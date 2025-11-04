import React from "react";

/**
 * PUBLIC_INTERFACE
 * Card (Common)
 * A reusable panel/surface with optional title, subtitle, and actions area.
 * Defaults to brown variant to align with dashboard KPI cards.
 */
export default function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  ariaLabel,
  variant = "brown",
}) {
  const base = "card";
  const variantClass = variant === "brown" ? "card-brown on-brown" : "";
  return (
    <section
      className={`${base} ${variantClass} ${className}`.trim()}
      aria-label={ariaLabel || (typeof title === "string" ? title : undefined)}
      role="region"
      style={{ display: "block", position: "relative", overflow: "visible" }}
    >
      {(title || actions || subtitle) && (
        <header className="card-header">
          <div>
            {title && <h3 className="card-title title">{title}</h3>}
            {subtitle && <div className="card-subtitle muted">{subtitle}</div>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-content">{children}</div>
    </section>
  );
}
