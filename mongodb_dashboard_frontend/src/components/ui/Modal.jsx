import React, { useEffect, useMemo } from "react";

/**
 * PUBLIC_INTERFACE
 * Modal
 * Shared overlay component that centers content and handles backdrop/ESC close.
 *
 * Props:
 * - open: boolean - controls visibility
 * - onClose: function - invoked to close modal (backdrop click or ESC)
 * - title: string - accessible label for dialog
 * - children: ReactNode - modal contents
 * - headerOffset: number|string (optional) - top offset to account for fixed headers.
 *     Examples: 60 (px), "60px", "var(--header-height, 60px)". Defaults to CSS var.
 * - overlayZIndex: number (optional) - z-index for backdrop overlay (default 1190)
 * - modalZIndex: number (optional) - z-index for modal card (default 1200)
 *
 * Behavior:
 * - Positions overlay as fixed and offsets it from the top by headerOffset so content
 *   starts below the fixed header. Keeps header clickable by not covering it with the overlay.
 * - Constrains modal height to calc(100vh - headerOffset - 48px) where 48px is overlay padding.
 * - Children can use a "sticky-header" class to pin headers within the scrollable card area.
 */
export default function Modal({
  title,
  open,
  onClose,
  children,
  headerOffset,          // number|string|undefined
  overlayZIndex = 1190,
  modalZIndex = 1200,
}) {
  const headerVar = "var(--header-height, 60px)";
  // Normalize top offset. Prefer explicit prop; fall back to CSS var with 60px fallback.
  const topValue = useMemo(() => {
    if (headerOffset == null) return headerVar;
    if (typeof headerOffset === "number") return `${headerOffset}px`;
    const s = String(headerOffset).trim();
    return s.length ? s : headerVar;
  }, [headerOffset]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === "Escape" && typeof onClose === "function") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Inline style to ensure height calc uses the same dynamic top value even if not tied to CSS var.
  const cardMaxHeight = `calc(100vh - ${topValue} - 48px)`; // 48px = overlay padding top+bottom

  return (
    <div
      className="modal-overlay-grid"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        // Close only when clicking on the backdrop
        if (e.target === e.currentTarget && typeof onClose === "function") onClose();
      }}
      style={{
        top: topValue,          // keep header clickable by starting overlay below header
        zIndex: overlayZIndex,  // stay above header visually if we ever overlay it
      }}
    >
      <div
        className="modal-card-shell"
        onClick={(e) => e.stopPropagation()}
        style={{
          zIndex: modalZIndex,
          maxHeight: cardMaxHeight,
        }}
      >
        {/* Children may include sticky header elements using 'sticky-header' */}
        <div className="modal-card-body-scroll">
          {children}
        </div>
      </div>

      <style>{`
        .modal-overlay-grid {
          position: fixed;
          inset: 0; /* we override top via inline style to honor header offset; other edges remain 0 */
          display: grid;
          place-items: center;
          padding: 24px;
          background: var(--modal-backdrop, rgba(0,0,0,0.3));
        }
        .modal-card-shell {
          margin: 0;
          transform: none;
          position: relative;
          width: min(96vw, 960px);
          /* max-height is set inline to use dynamic header offset, but keep a CSS fallback too */
          max-height: calc(100vh - var(--header-height, 60px) - 48px);
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
          -webkit-overflow-scrolling: touch;
        }
        /* Allow children to define sticky header inside */
        .modal-card-shell .sticky-header {
          position: sticky;
          top: 0;
          z-index: 1;
          background: inherit;
          backdrop-filter: saturate(1) blur(2px);
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
