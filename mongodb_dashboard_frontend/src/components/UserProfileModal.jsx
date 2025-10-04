import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Button from "./ui/Button.jsx";

/**
 * PUBLIC_INTERFACE
 * UserProfileModal
 * Accessible, responsive modal that shows a selected user's core profile information only.
 * - Shows ONLY: Name, Email, Department, and Tenant ID.
 * - Ocean Professional theme: rounded corners, subtle shadows, smooth transitions, clean layout.
 * - Accessibility: role=dialog, aria-modal, labelledby/desc, focus trap, ESC/overlay close, and focus return.
 */
// PUBLIC_INTERFACE
export default function UserProfileModal({ open, onClose, user }) {
  /**
   * Modal with structured core user details in read-only form controls.
   * Props:
   * - open: boolean, controls visibility
   * - onClose: function, called when user dismisses modal (overlay click, ESC, or buttons)
   * - user: object, the selected user's data
   *
   * Accessibility and behavior:
   * - Focus is trapped within the modal while open
   * - ESC closes the modal
   * - Clicking the backdrop closes the modal
   * - Focus returns to the previously focused element after close
   */
  const safeUser = user || {};

  // Derive avatar initial
  const avatarChar = useMemo(() => {
    const name =
      safeUser?.name ||
      safeUser?.full_name ||
      safeUser?.username ||
      safeUser?.email ||
      "";
    return String(name).trim().charAt(0).toUpperCase() || "U";
  }, [safeUser]);

  // Resolve tenant/organization display from multiple possible keys
  const tenantDisplay = useMemo(() => {
    return (
      safeUser?.tenant_id ??
      safeUser?.organization_name ??
      safeUser?.organization ??
      safeUser?.organization_id ??
      ""
    );
  }, [safeUser]);

  // Core fields restricted to Name, Email, Department, Tenant ID (read-only)
  const fields = useMemo(
    () => [
      { key: "name", label: "Name", value: safeUser?.name || safeUser?.full_name || "" },
      { key: "email", label: "Email", value: safeUser?.email || "" },
      { key: "department", label: "Department", value: safeUser?.department || "" },
      { key: "__tenant", label: "Tenant ID", value: tenantDisplay || "" },
    ],
    [safeUser, tenantDisplay]
  );

  const title =
    (safeUser?.name && `User Profile — ${safeUser.name}`) ||
    (safeUser?.email && `User Profile — ${safeUser.email}`) ||
    "User Profile";

  // ARIA ids
  const labelId = useId();
  const descId = useId();

  // Refs for focus handling and trap
  const backdropRef = useRef(null);
  const cardRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Simple "enter" animation state
  const [entered, setEntered] = useState(false);

  // Attach/detach ESC to close and manage focus return/trap
  useEffect(() => {
    if (!open) return;
    setEntered(false);
    // Wait one tick to allow DOM to paint, then toggle enter state and focus
    const raf = requestAnimationFrame(() => setEntered(true));

    // Record previously focused element
    previouslyFocusedRef.current = document.activeElement;

    // Move focus to the first focusable element inside the dialog
    const focusFirst = () => {
      if (!cardRef.current) return;
      const nodes = getFocusableElements(cardRef.current);
      if (nodes.length > 0) nodes[0].focus();
      else cardRef.current.focus();
    };
    const t = setTimeout(focusFirst, 0);

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (typeof onClose === "function") onClose();
      }
      // Focus trap logic
      if (e.key === "Tab") {
        trapTabKey(e, cardRef.current);
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
      // Return focus to the previously focused element, if still in the document
      try {
        if (previouslyFocusedRef.current && previouslyFocusedRef.current.focus) {
          previouslyFocusedRef.current.focus();
        }
      } catch {
        // ignore focus restoration errors
      }
      setEntered(false);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Backdrop click handler (only close when clicking the backdrop itself, not children)
  function onBackdropClick(e) {
    if (e.target === e.currentTarget) {
      if (typeof onClose === "function") onClose();
    }
  }

  // Helper to format placeholders for empty values
  function displayValue(v) {
    return v == null || v === "" ? "" : String(v);
  }

  // Primary and Secondary buttons both close (no state change to data)
  function handlePrimary() {
    if (typeof onClose === "function") onClose();
  }
  function handleSecondary() {
    if (typeof onClose === "function") onClose();
  }

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      role="presentation"
      onClick={onBackdropClick}
      style={{
        // Elevated, bluish overlay with subtle blur per Ocean Professional theme
        background: "rgba(17,24,39,0.45)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        zIndex: 90, // slightly above default to ensure clarity
        transition: "background 160ms ease",
      }}
    >
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        aria-describedby={descId}
        // Make card focusable as a fallback
        tabIndex={-1}
        style={{
          maxWidth: 640,
          borderRadius: 14,
          boxShadow: "0 12px 30px rgba(15,23,42,0.15), 0 4px 14px rgba(2,6,23,0.08)",
          border: "1px solid var(--border-subtle)",
          overflow: "hidden",
          transform: entered ? "translateY(0) scale(1)" : "translateY(6px) scale(0.98)",
          opacity: entered ? 1 : 0.98,
          transition: "transform 160ms ease, opacity 160ms ease",
          background: "var(--bg-surface)",
        }}
        onClick={(e) => {
          // Prevent clicks inside the card from bubbling to the backdrop
          e.stopPropagation();
        }}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-subtle)",
            background:
              "linear-gradient(180deg, rgba(37,99,235,0.06), rgba(255,255,255,0))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div
              aria-hidden="true"
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#2563EB", // primary
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
                flex: "0 0 auto",
              }}
            >
              {avatarChar}
            </div>
            <div style={{ minWidth: 0 }}>
              <h3
                id={labelId}
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={title}
              >
                {title}
              </h3>
              <div
                className="muted"
                id={descId}
                style={{ fontSize: 12, color: "var(--text-tertiary)" }}
              >
                Read-only user details
              </div>
            </div>
          </div>

          <Button
            variant="ghost"
            aria-label="Close"
            onClick={onClose}
            title="Close dialog"
          >
            ✕
          </Button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: 16 }}>
          {/* Section: Profile summary */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 6,
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>
              {safeUser?.name || safeUser?.full_name || "—"}
            </div>
            <div
              className="muted"
              style={{ fontSize: 12, color: "var(--text-tertiary)" }}
              title={safeUser?.email || undefined}
            >
              {safeUser?.email || "—"}
            </div>
          </div>

          {/* Section: Read-only form controls */}
          <div className="form-grid" style={{ gap: 16 }}>
            {fields.map((f) => {
              const id = `${f.key}-input-${labelId}`; // ensure uniqueness with useId seed
              const value = displayValue(f.value);
              const helper =
                f.key === "name"
                  ? "Your display name"
                  : f.key === "email"
                  ? "Primary contact email"
                  : f.key === "department"
                  ? "Department or team"
                  : f.key === "__tenant"
                  ? "Derived from tenant/organization fields"
                  : "";

              return (
                <label key={f.key} htmlFor={id} style={{ display: "grid", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-tertiary)",
                      fontWeight: 600,
                      letterSpacing: ".02em",
                    }}
                  >
                    {f.label}
                  </span>
                  <input
                    id={id}
                    type="text"
                    readOnly
                    aria-readonly="true"
                    value={value}
                    placeholder={value ? undefined : "Not provided"}
                    style={{
                      // Enhance input look specifically for this modal to align with requested accents
                      border: "1px solid var(--input-border)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      background: "#fff",
                      color: "var(--text-primary)",
                      outline: "none",
                      height: 40,
                      transition: "box-shadow .15s ease, border-color .15s ease",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "#2563EB";
                      e.currentTarget.style.boxShadow =
                        "0 0 0 3px rgba(37, 99, 235, 0.28)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "var(--input-border)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  />
                  <span
                    className="muted"
                    style={{ fontSize: 12, color: "var(--text-tertiary)" }}
                  >
                    {helper}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div
          className="modal-footer"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--bg-surface)",
          }}
        >
          <div className="muted" style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            Press Esc to close
          </div>
          <div className="modal-actions" style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={handleSecondary} title="Close">
              Close
            </Button>
            <Button
              variant="primary"
              onClick={handlePrimary}
              title="Done"
              aria-label="Done"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Get focusable nodes inside a root element.
 */
function getFocusableElements(root) {
  if (!root) return [];
  const selector =
    'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [contenteditable], [tabindex]:not([tabindex="-1"])';
  const nodes = Array.from(root.querySelectorAll(selector));
  // Only visible items
  return nodes.filter((el) => {
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

/**
 * Trap tab key inside a container to maintain focus within the modal.
 */
function trapTabKey(e, container) {
  if (!container) return;
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    e.preventDefault();
    container.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (e.shiftKey) {
    // shift + tab
    if (active === first || !container.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    // tab
    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
