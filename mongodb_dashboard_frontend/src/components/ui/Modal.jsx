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
        // Fixed overlay covering entire viewport and staying centered on scroll/resize
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Responsive padding including safe-area insets for mobile
        padding: '16px',
        // Ocean Professional semi-transparent backdrop (use CSS var with fallback)
        backgroundColor: 'var(--modal-backdrop, rgba(17,24,39,0.5))',
        // Ensure overlay is above app header/other content
        zIndex: 1100,
        // When content is taller than viewport, allow the overall overlay to scroll
        overflowY: 'auto',
      }}
    >
      {/* Content wrapper: full-width within padding, no absolute positioning.
          Constrain height to viewport and enable internal scrolling via children. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          // Cap width to a comfortable reading width while keeping responsiveness
          maxWidth: 'min(960px, 100%)',
          // Ensure any direct content that needs to fill height can do so responsibly
          // Consumers should still manage their internal scroll areas.
          maxHeight: 'calc(100vh - 32px)',
          // No overflow hidden here to allow inner components to manage their own scroll,
          // but keep the wrapper visually unobtrusive.
          // Visual defaults aligned with Ocean Professional for modals that do not set their own styles.
          background: 'transparent',
          borderRadius: 0,
          boxShadow: 'none',
          border: 'none',
        }}
      >
        {children}
      </div>

      {/* Responsive padding refinement for very small viewports with safe-area insets */}
      <style>{`
        @media (max-width: 639px) {
          [role="dialog"] {
            padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
          }
        }
      `}</style>
    </div>
  );
}
