import React from "react";

/**
 * PUBLIC_INTERFACE
 * Modal
 * A simple overlay container that centers its children and closes on backdrop click.
 * Consumers are responsible for rendering header/body/footer within children.
 */
export default function Modal({ title, open, onClose, children }) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget && typeof onClose === 'function') onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(17,24,39,0.5)', // subtle dark overlay
        zIndex: 80,
        padding: 16,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '100%' }}>
        {children}
      </div>
    </div>
  );
}
