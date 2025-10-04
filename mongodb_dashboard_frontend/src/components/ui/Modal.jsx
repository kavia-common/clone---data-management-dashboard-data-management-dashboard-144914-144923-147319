import React from "react";

/**
 * PUBLIC_INTERFACE
 * Modal
 * A simple overlay container that centers its children and closes on backdrop click.
 * Consumers are responsible for rendering header/body/footer within children.
 *
 * Behavior:
 * - Uses a fixed, full-screen overlay with flex centering so the modal stays centered on scroll/resize.
 * - Backdrop is a semi-transparent black rgba(0,0,0,0.3) per requirement (with CSS var fallback).
 * - Content wrapper enforces max-width and max-height with internal scroll.
 * - Backdrop click-to-close remains intact; children control internal focus/scrolling.
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
        // Semi-transparent backdrop per request; allow CSS var override
        background: 'var(--modal-backdrop, rgba(0,0,0,0.3))',
        // Ensure overlay is above app header/other content
        zIndex: 1100,
        // Allow overlay to scroll if an extremely tall modal is rendered
        overflowY: 'auto',
      }}
    >
      {/* Content wrapper:
          - Fill available width within overlay padding
          - Constrain size and allow internal scroll to keep header/footer visible
      */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 'min(960px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          // Provide a default card surface if children don't set one
          background: 'var(--bg-surface, #ffffff)',
          borderRadius: 12,
          boxShadow: '0 8px 20px rgba(16,24,40,0.12)',
          border: 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Inner scroll region: wrap children in a flex column to allow content to scroll if needed */}
        <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          {children}
        </div>
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
