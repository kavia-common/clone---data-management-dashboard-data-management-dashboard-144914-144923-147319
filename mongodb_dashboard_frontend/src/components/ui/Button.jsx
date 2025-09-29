import React from "react";

// PUBLIC_INTERFACE
export default function Button({ children, variant = "primary", className = "", ...rest }) {
  /** A themed button with variants: primary, secondary, danger, ghost. */
  const variants = {
    primary: "btn btn-primary",
    secondary: "btn btn-secondary",
    danger: "btn btn-danger",
    ghost: "btn btn-ghost",
  };
  const classes = `${variants[variant] || variants.primary} ${className}`.trim();
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
