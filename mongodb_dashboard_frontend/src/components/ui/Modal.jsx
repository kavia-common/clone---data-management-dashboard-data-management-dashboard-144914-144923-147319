import React from "react";
import Button from "./Button.jsx";

// PUBLIC_INTERFACE
export default function Modal({ title, open, onClose, children, footer }) {
  /** Accessible modal with header, body, and footer areas. */
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        // clicking on backdrop closes the modal
        if (e.target === e.currentTarget && typeof onClose === 'function') onClose();
      }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <Button variant="ghost" aria-label="Close" title="Close" onClick={onClose}>✕</Button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
    </div>
  );
}
