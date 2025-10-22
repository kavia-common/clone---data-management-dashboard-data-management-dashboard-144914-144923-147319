import React from "react";

/**
 * PUBLIC_INTERFACE
 * Tag
 * A small pill used for categorization or status labelling.
 * Accepts children and optional className for spacing overrides.
 */
export default function Tag({ children, className = "", ...rest }) {
  const classes = `tag ${className}`.trim();
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
