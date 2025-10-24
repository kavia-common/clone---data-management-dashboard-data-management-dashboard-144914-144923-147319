import React from "react";

/**
 * PUBLIC_INTERFACE
 * Card surface with optional header, subtitle and actions.
 * Applies Ocean Professional surface styling via CSS classes (theme.css/globals.css).
 * Supports a "brown" variant for dashboard KPI cards.
 */
export default function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  ariaLabel,
  variant = "brown", // default to brown per requirement
}) {
  const base = "card";
  const variantClass = variant === "brown" ? "card-brown on-brown" : "";
  return (
    <section
      className={`${base} ${variantClass} ${className}`.trim()}
      aria-label={ariaLabel || (typeof title === "string" ? title : undefined)}
      role="region"
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
