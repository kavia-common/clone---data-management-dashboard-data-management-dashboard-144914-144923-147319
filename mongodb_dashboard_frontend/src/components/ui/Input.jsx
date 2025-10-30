import React, { forwardRef } from "react";

/**
 * PUBLIC_INTERFACE
 * Input
 * A themed text input that adheres to the app's design tokens.
 * Props mirror native input props; className extends base styling.
 */
const Input = forwardRef(function Input(
  { className = "", ...props },
  ref
) {
  const classes = `ui-input ${className}`.trim();
  return <input ref={ref} className={classes} {...props} />;
});

export default Input;
