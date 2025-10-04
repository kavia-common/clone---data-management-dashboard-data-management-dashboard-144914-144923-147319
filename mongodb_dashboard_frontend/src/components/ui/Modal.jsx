import React, { useEffect } from "react";

/**
 * PUBLIC_INTERFACE
 * Modal
 * Shared overlay component that centers content precisely and handles backdrop/ESC close.
 *
 * Usage:
 * - Pass any children. The container will provide sizing and overflow management.
 * - Keep headers inside children sticky if needed using className="sticky-header".
 */
export default function Modal({ title, open, onClose, children }) {
  // Close on ESC (hook must not be conditional)
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === 'Escape' && typeof onClose === 'function') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay-grid"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        // Close only when clicking on the backdrop
        if (e.target === e.currentTarget && typeof onClose === 'function') onClose();
      }}
    >
      <div
        className="modal-card-shell"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Children are expected to structure their own header/body with sticky header if needed */}
        <div className="modal-card-body-scroll">
          {children}
        </div>
      </div>

      <style>{`
        .modal-overlay-grid {
          position: fixed;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 24px;
          background: rgba(0,0,0,0.3);
          z-index: 1000;
        }
        .modal-card-shell {
          margin: 0;
          transform: none;
          position: relative;
          width: min(96vw, 960px);
          max-height: min(92vh, 800px);
          border: none;
          border-radius: 12px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background: var(--bg-surface, #fff);
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        .modal-card-body-scroll {
          flex: 1;
          min-height: 0;
          overflow: auto;
          display: flex;
          flex-direction: column;
        }
        /* Allow children to define sticky header inside */
        .modal-card-shell .sticky-header {
          position: sticky;
          top: 0;
          z-index: 1;
          background: inherit;
        }

        /* Safe area on small screens */
        @media (max-width: 639px) {
          .modal-overlay-grid {
            padding:
              max(12px, env(safe-area-inset-top))
              max(12px, env(safe-area-inset-right))
              max(12px, env(safe-area-inset-bottom))
              max(12px, env(safe-area-inset-left));
          }
        }
      `}</style>
    </div>
  );
}
