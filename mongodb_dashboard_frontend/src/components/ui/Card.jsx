import React from "react";

/**
 * Card surface with optional header, subtitle and actions.
 * Applies Ocean Professional surface styling via CSS classes in App.css.
 */
// PUBLIC_INTERFACE
export default function Card({ title, subtitle, actions, children, className = "" }) {
  /** Surface card with optional header and action slot. */
  return (
    <div className={`card ${className}`}>
      {(title || actions || subtitle) && (
        <div className="card-header">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <div className="card-subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className="card-content">{children}</div>
    </div>
  );
}
