import React from "react";

/**
 * PUBLIC_INTERFACE
 * Card
 * A reusable panel/surface with optional title, subtitle, and actions area.
 * Applies Ocean Professional theme tokens via CSS (theme.css).
 */
export default function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  ariaLabel,
}) {
  return (
    <section
      className={`card ${className}`}
      aria-label={ariaLabel || (typeof title === "string" ? title : undefined)}
      role="region"
    >
      {(title || actions || subtitle) && (
        <header className="card-header">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <div className="card-subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-content">{children}</div>
    </section>
  );
}
