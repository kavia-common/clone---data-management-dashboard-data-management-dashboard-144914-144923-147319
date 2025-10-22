import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

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
 * - width: number|string (optional) - max modal width (e.g., 860 or "860px" or "min(96vw, 860px)")
 * - footer: ReactNode (optional) - optional footer actions area that stays fixed at the bottom of the scrollable body
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
  width = "min(96vw, 860px)",
  maxWidth = "min(92vw, 720px)",
  footer,
  className,
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

  return createPortal(
    <div
      className="modal-overlay-grid"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget && typeof onClose === "function") onClose();
      }}
      style={{
        top: topValue,
        zIndex: overlayZIndex,
      }}
    >
      <div
        className={`modal-card-shell${className ? ` ${className}` : ""}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          zIndex: modalZIndex,
          maxHeight: cardMaxHeight,
          width: typeof width === "number" ? `${width}px` : width,
          maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
        }}
      >
        <div className="modal-card-body-scroll">
          {children}
          {footer ? <div className="modal-footer">{footer}</div> : null}
        </div>
      </div>

      <style>{`
        .modal-overlay-grid {
          position: fixed;
          inset: 0;
          padding: 24px;
          background: var(--modal-backdrop, rgba(0,0,0,0.3));
        }
        .modal-card-shell {
          position: fixed;
          top: calc(${topValue} + 50%);
          left: 50%;
          transform: translate(-50%, -50%);
          margin: 0;
          /* Add subtle delineation on white backgrounds for AA contrast */
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          /* Respect Ocean Professional surface token */
          background: var(--bg-surface, #fff);
          /* Maintain soft elevation */
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          max-width: min(92vw, 720px);
          box-sizing: border-box;
        }
        /* Costs modal variant: apply a faint canvas tint to the scroll body to avoid white-on-white */
        .modal-card-shell.modal--costs .modal-card-body-scroll {
          background: var(--bg-canvas, #f9fafb);
        }
        .modal-card-body-scroll {
          flex: 1;
          min-height: 0;
          overflow: auto;
          display: flex;
          flex-direction: column;
          -webkit-overflow-scrolling: touch;
        }
        .modal-footer {
          position: sticky;
          bottom: 0;
          background: linear-gradient(180deg, rgba(255,255,255,0.9), #ffffff);
          border-top: 1px solid var(--border-subtle);
          padding: 12px 16px;
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .modal-card-shell .sticky-header {
          position: sticky;
          top: 0;
          z-index: 1;
          background: inherit;
          backdrop-filter: saturate(1) blur(2px);
        }
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
    </div>,
    document.body
  );
}
