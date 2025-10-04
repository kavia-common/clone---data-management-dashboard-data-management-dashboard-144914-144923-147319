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
        // Close only when clicking on the backdrop (not inside the modal content)
        if (e.target === e.currentTarget && typeof onClose === 'function') onClose();
      }}
      style={{
        // Fixed overlay covering entire viewport
        position: 'fixed',
        inset: 0,
        // Flex centering to avoid layout shifts and ensure proper centering on all sizes
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Small padding so the modal has breathing room on small screens
        padding: 16,
        // Backdrop
        background: 'rgba(17,24,39,0.5)',
        // Ensure overlay is above app header/other content
        zIndex: 1000,
        // Allow internal scrolling when content exceeds viewport height
        overflowY: 'auto',
      }}
    >
      {/* Container to prevent click bubbling to backdrop and to constrain width */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          // Let consumer set max sizes; default to full width within padding
          width: '100%',
          maxWidth: '100%',
          // Do not set absolute heights here; consumer provides maxHeight and scroll on inner content
        }}
      >
        {children}
      </div>
    </div>
  );
}
