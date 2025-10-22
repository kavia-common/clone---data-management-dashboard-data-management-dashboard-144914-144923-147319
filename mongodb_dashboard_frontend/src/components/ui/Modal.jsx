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
        /* GxP: Accessibility/contrast fix for Costs View Details modal (REQ-UI-COSTS-MODAL-BG)
           - Enforce application background in modal body, headers, sections, and inner components
           - Neutralize any lingering white backgrounds (bg-white/#fff/#f8fafc/etc.) inside the costs modal subtree
           - Maintain borders/shadows for separation
           - Ensure primary text color is readable; secondary text has sufficient contrast
        */
        .modal-card-shell.modal--costs .modal-card-body-scroll,
        .modal-card-shell.modal--costs .modal__body,
        .modal-card-shell.modal--costs .modal__content {
          background: var(--bg-canvas, var(--ocean-bg, #f9fafb)) !important;
        }
        /* Headers/footers explicitly aligned to app background */
        .modal-card-shell.modal--costs .sticky-header,
        .modal-card-shell.modal--costs .modal__header,
        .modal-card-shell.modal--costs .modal__footer {
          background: var(--bg-canvas, var(--ocean-bg, #f9fafb)) !important;
        }
        /* Section and card-like blocks default to app background unless intentionally surfaced */
        .modal-card-shell.modal--costs .details-panel,
        .modal-card-shell.modal--costs .section,
        .modal-card-shell.modal--costs .card,
        .modal-card-shell.modal--costs .card-header,
        .modal-card-shell.modal--costs .card-content {
          background: var(--bg-canvas, var(--ocean-bg, #f9fafb)) !important;
          border-color: var(--border-subtle, #e5e7eb) !important;
        }
        /* Explicit surface variant for true cards: keep white but fix text/border for contrast */
        .modal-card-shell.modal--costs .card--surface,
        .modal-card-shell.modal--costs .surface,
        .modal-card-shell.modal--costs .dv-grid.surface,
        .modal-card-shell.modal--costs .card.card--surface {
          background: var(--surface, #ffffff) !important;
          color: inherit !important; /* Use existing theme color; do not force black */
          border: 1px solid var(--border-subtle, #e5e7eb) !important;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        /* Neutralize inline/utility whites within costs modal (handles common hard-coded colors) */
        .modal-card-shell.modal--costs [style*="background:#fff"],
        .modal-card-shell.modal--costs [style*="background: #fff"],
        .modal-card-shell.modal--costs [style*="background:#ffffff"],
        .modal-card-shell.modal--costs [style*="background: #ffffff"],
        .modal-card-shell.modal--costs [style*="background:#f8fafc"],
        .modal-card-shell.modal--costs [style*="background: #f8fafc"],
        .modal-card-shell.modal--costs [style*="background:#fcfcfd"],
        .modal-card-shell.modal--costs [style*="background: #fcfcfd"],
        .modal-card-shell.modal--costs [style*="background:#fafcff"],
        .modal-card-shell.modal--costs [style*="background: #fafcff"] {
          background: var(--bg-canvas, var(--ocean-bg, #f9fafb)) !important;
        }
        /* Legacy utility classes */
        .modal-card-shell.modal--costs .bg-white,
        .modal-card-shell.modal--costs [class*="bg-white"] {
          background: var(--bg-canvas, var(--ocean-bg, #f9fafb)) !important;
        }
        /* Text contrasts */
        /* [Scoped change] Removed global text color override to limit black text to array/object content only. */
        .modal-card-shell.modal--costs .muted,
        .modal-card-shell.modal--costs .text-secondary,
        .modal-card-shell.modal--costs .dv-summary,
        .modal-card-shell.modal--costs .dv-chip {
          color: var(--text-secondary, #374151);
        }
        /* TreeView specific tuning within costs modal */
        .modal-card-shell.modal--costs .tv-row-main:hover {
          background: color-mix(in oklab, var(--bg-surface, #ffffff) 12%, transparent) !important;
          border-color: var(--border-subtle, #e5e7eb) !important;
        }
        .modal-card-shell.modal--costs .tv-toggle {
          background: var(--bg-surface, #ffffff) !important;
          color: var(--text-primary, #111827) !important;
          border-color: var(--border-subtle, #e5e7eb) !important;
        }

        /* GxP Accessibility: High-contrast text override for the specific Array(n) block within Costs View Details modal only.
           Scope narrowly to the costs modal and the array-contrast-block container to avoid side effects in other modals.
           Ensures the Array badge, keys (dt), colon, and values inside the array block use #111827, and nested spans/code inherit. */
        .modal-card-shell.modal--costs .array-contrast-block .tv-badge {
          color: #111827 !important;  /* Ensure Array(n) label is black for contrast */
        }
        .modal-card-shell.modal--costs .array-contrast-block .tv-key,
        .modal-card-shell.modal--costs .array-contrast-block .tv-colon,
        .modal-card-shell.modal--costs .array-contrast-block .tv-value {
          color: #111827 !important;  /* Keys/values black within array block */
        }
        .modal-card-shell.modal--costs .array-contrast-block,
        .modal-card-shell.modal--costs .array-contrast-block * {
          color: #111827; /* Ensure nested spans/code inherit black text */
        }
        /* Footer separator while avoiding white slab look */
        .modal-card-shell.modal--costs .modal-footer {
          background: linear-gradient(
            180deg,
            color-mix(in oklab, var(--bg-canvas, #f9fafb) 85%, transparent),
            var(--bg-canvas, #f9fafb)
          ) !important;
          border-top: 1px solid var(--border-subtle, #e5e7eb) !important;
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
