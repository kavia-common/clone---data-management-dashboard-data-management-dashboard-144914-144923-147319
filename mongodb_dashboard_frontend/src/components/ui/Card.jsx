import React from "react";
import PropTypes from "prop-types";

/**
 * PUBLIC_INTERFACE
 * Card
 * Lightweight themed card wrapper providing header, subtitle, and content slots.
 */
export default function Card({ title, subtitle, children, className, style, ariaLabel }) {
  return (
    <div className={className ? `card ${className}` : "card"} style={style} aria-label={ariaLabel}>
      {(title || subtitle) && (
        <div className="card-header" style={{ paddingBottom: 0 }}>
          {title && <h3 className="card-title">{title}</h3>}
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
      )}
      <div className="card-content">{children}</div>
    </div>
  );
}

Card.propTypes = {
  title: PropTypes.string,
  subtitle: PropTypes.string,
  children: PropTypes.node,
  className: PropTypes.string,
  style: PropTypes.object,
  ariaLabel: PropTypes.string,
};
